const { DynamoDBClient } = require("@aws-sdk/client-dynamodb");
const {
    DynamoDBDocumentClient,
    PutCommand,
    UpdateCommand,
    GetCommand,
    DeleteCommand,
} = require("@aws-sdk/lib-dynamodb");
const {
    EventBridgeClient,
    PutEventsCommand,
} = require("@aws-sdk/client-eventbridge");
const { v4: uuidv4 } = require("uuid");

const dynamoClient = new DynamoDBClient({});
const docClient = DynamoDBDocumentClient.from(dynamoClient);
const eventBridgeClient = new EventBridgeClient({});

const ORDERS_TABLE = process.env.ORDERS_TABLE;
const EVENT_BUS_NAME = process.env.EVENT_BUS_NAME || "default";

/**
 * Order Service - Producer
 * Accepts order requests, stores order, and emits OrderCreated event
 */
exports.createOrder = async (event) => {
    console.log(
        "Order Service: Received order request",
        JSON.stringify(event, null, 2)
    );

    try {
        const body = JSON.parse(event.body || "{}");
        const { userId, productId, quantity } = body;

        // Validation
        if (!userId || !productId || !quantity || quantity <= 0) {
            return {
                statusCode: 400,
                headers: {
                    "Content-Type": "application/json",
                    "Access-Control-Allow-Origin": "*",
                },
                body: JSON.stringify({
                    error: "Missing required fields: userId, productId, quantity (must be > 0)",
                }),
            };
        }

        // Generate order ID
        const orderId = `ord-${uuidv4()}`;
        const timestamp = new Date().toISOString();

        // Create order record
        const order = {
            orderId,
            userId,
            productId,
            quantity: parseInt(quantity, 10),
            status: "PENDING",
            createdAt: timestamp,
            updatedAt: timestamp,
        };

        // Save order to DynamoDB
        await docClient.send(
            new PutCommand({
                TableName: ORDERS_TABLE,
                Item: order,
            })
        );

        console.log(`Order Service: Order ${orderId} saved to DynamoDB`);

        // Emit OrderCreated event to EventBridge
        const eventDetail = {
            orderId,
            userId,
            productId,
            quantity: order.quantity,
            timestamp,
            version: "1.0",
        };

        const putEventsCommand = new PutEventsCommand({
            Entries: [
                {
                    Source: "eventflow.orders",
                    DetailType: "OrderCreated",
                    Detail: JSON.stringify(eventDetail),
                    EventBusName: EVENT_BUS_NAME,
                },
            ],
        });

        await eventBridgeClient.send(putEventsCommand);
        console.log(
            `Order Service: OrderCreated event emitted for order ${orderId}`
        );

        return {
            statusCode: 201,
            headers: {
                "Content-Type": "application/json",
                "Access-Control-Allow-Origin": "*",
            },
            body: JSON.stringify({
                message: "Order created successfully",
                orderId,
                order,
            }),
        };
    } catch (error) {
        console.error("Order Service: Error processing order", error);
        return {
            statusCode: 500,
            headers: {
                "Content-Type": "application/json",
                "Access-Control-Allow-Origin": "*",
            },
            body: JSON.stringify({
                error: "Failed to create order",
                message: error.message,
            }),
        };
    }
};

/**
 * Update Order - API
 * Updates the status of an existing order
 *
 * HTTP:
 *   PATCH /orders/{orderId}
 *   Body: { "status": "PAID" }
 */
exports.updateOrder = async (event) => {
    console.log(
        "Order Service: Received update order request",
        JSON.stringify(event, null, 2)
    );

    const headers = {
        "Content-Type": "application/json",
        "Access-Control-Allow-Origin": "*",
    };

    try {
        const orderId = event.pathParameters?.orderId;
        const body = JSON.parse(event.body || "{}");
        const { status } = body;

        if (!orderId) {
            return {
                statusCode: 400,
                headers,
                body: JSON.stringify({
                    error: "Missing path parameter: orderId",
                }),
            };
        }

        if (!status || typeof status !== "string") {
            return {
                statusCode: 400,
                headers,
                body: JSON.stringify({
                    error: "Missing or invalid field: status (must be a non-empty string)",
                }),
            };
        }

        const timestamp = new Date().toISOString();

        try {
            const result = await docClient.send(
                new UpdateCommand({
                    TableName: ORDERS_TABLE,
                    Key: { orderId },
                    UpdateExpression:
                        "SET #status = :status, updatedAt = :updatedAt",
                    ExpressionAttributeNames: {
                        "#status": "status",
                    },
                    ExpressionAttributeValues: {
                        ":status": status,
                        ":updatedAt": timestamp,
                    },
                    ConditionExpression: "attribute_exists(orderId)",
                    ReturnValues: "ALL_NEW",
                })
            );

            console.log(
                `Order Service: Order ${orderId} status updated to ${status}`
            );

            return {
                statusCode: 200,
                headers,
                body: JSON.stringify({
                    message: "Order status updated successfully",
                    order: result.Attributes,
                }),
            };
        } catch (err) {
            if (err.name === "ConditionalCheckFailedException") {
                console.warn(
                    `Order Service: Order ${orderId} not found for update`
                );
                return {
                    statusCode: 404,
                    headers,
                    body: JSON.stringify({
                        error: "Order not found",
                        orderId,
                    }),
                };
            }

            throw err;
        }
    } catch (error) {
        console.error("Order Service: Error updating order", error);
        return {
            statusCode: 500,
            headers,
            body: JSON.stringify({
                error: "Failed to update order",
                message: error.message,
            }),
        };
    }
};

/**
 * Get Order - API
 * Retrieves order details by orderId
 *
 * HTTP:
 *   GET /orders/{orderId}
 */
exports.getOrder = async (event) => {
    console.log(
        "Order Service: Received get order request",
        JSON.stringify(event, null, 2)
    );

    const headers = {
        "Content-Type": "application/json",
        "Access-Control-Allow-Origin": "*",
    };

    try {
        const orderId = event.pathParameters?.orderId;

        if (!orderId) {
            return {
                statusCode: 400,
                headers,
                body: JSON.stringify({
                    error: "Missing path parameter: orderId",
                }),
            };
        }

        const result = await docClient.send(
            new GetCommand({
                TableName: ORDERS_TABLE,
                Key: { orderId },
            })
        );

        if (!result.Item) {
            return {
                statusCode: 404,
                headers,
                body: JSON.stringify({
                    error: "Order not found",
                    orderId,
                }),
            };
        }

        return {
            statusCode: 200,
            headers,
            body: JSON.stringify({
                order: result.Item,
            }),
        };
    } catch (error) {
        console.error("Order Service: Error fetching order", error);
        return {
            statusCode: 500,
            headers,
            body: JSON.stringify({
                error: "Failed to fetch order",
                message: error.message,
            }),
        };
    }
};

/**
 * Delete Order - API
 * Deletes an order by orderId
 *
 * HTTP:
 *   DELETE /orders/{orderId}
 */
exports.deleteOrder = async (event) => {
    console.log(
        "Order Service: Received delete order request",
        JSON.stringify(event, null, 2)
    );

    const headers = {
        "Content-Type": "application/json",
        "Access-Control-Allow-Origin": "*",
    };

    try {
        const orderId = event.pathParameters?.orderId;

        if (!orderId) {
            return {
                statusCode: 400,
                headers,
                body: JSON.stringify({
                    error: "Missing path parameter: orderId",
                }),
            };
        }

        try {
            await docClient.send(
                new DeleteCommand({
                    TableName: ORDERS_TABLE,
                    Key: { orderId },
                    ConditionExpression: "attribute_exists(orderId)",
                })
            );
        } catch (err) {
            if (err.name === "ConditionalCheckFailedException") {
                return {
                    statusCode: 404,
                    headers,
                    body: JSON.stringify({
                        error: "Order not found",
                        orderId,
                    }),
                };
            }
            throw err;
        }

        return {
            statusCode: 200,
            headers,
            body: JSON.stringify({
                message: "Order deleted successfully",
                orderId,
            }),
        };
    } catch (error) {
        console.error("Order Service: Error deleting order", error);
        return {
            statusCode: 500,
            headers,
            body: JSON.stringify({
                error: "Failed to delete order",
                message: error.message,
            }),
        };
    }
};


