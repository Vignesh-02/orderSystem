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
const {
    createLogger,
    getCorrelationIdFromHttpEvent,
} = require("../shared/logger");

const dynamoClient = new DynamoDBClient({});
const docClient = DynamoDBDocumentClient.from(dynamoClient);
const eventBridgeClient = new EventBridgeClient({});

const logger = createLogger("OrderService");

const ORDERS_TABLE = process.env.ORDERS_TABLE;
const EVENT_BUS_NAME = process.env.EVENT_BUS_NAME || "default";

/**
 * Order Service - Producer
 * Accepts order requests, stores order, and emits OrderCreated event
 */
exports.createOrder = async (event) => {
    const correlationId = getCorrelationIdFromHttpEvent(event);

    logger.info("Received create order request", {
        correlationId,
    });

    try {
        const body = JSON.parse(event.body || "{}");
        const { userId, productId, quantity } = body;

        // Validation
        if (!userId || !productId || !quantity || quantity <= 0) {
            logger.warn("Validation failed for createOrder", {
                correlationId,
                userId,
                productId,
                quantity,
            });
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

        logger.info("Order saved to DynamoDB", {
            correlationId,
            orderId,
            userId,
            productId,
            quantity: order.quantity,
        });

        // Emit OrderCreated event to EventBridge
        const eventDetail = {
            orderId,
            userId,
            productId,
            quantity: order.quantity,
            timestamp,
            version: "1.0",
            correlationId,
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
        logger.info("OrderCreated event emitted", {
            correlationId,
            orderId,
        });

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
        logger.error("Error processing createOrder", {
            correlationId: getCorrelationIdFromHttpEvent(event),
            error,
        });
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
    const correlationId = getCorrelationIdFromHttpEvent(event);

    logger.info("Received update order request", {
        correlationId,
        pathParameters: event.pathParameters,
    });

    const headers = {
        "Content-Type": "application/json",
        "Access-Control-Allow-Origin": "*",
    };

    try {
        const orderId = event.pathParameters?.orderId;
        const body = JSON.parse(event.body || "{}");
        const { status } = body;

        if (!orderId) {
            logger.warn("Missing orderId in updateOrder", {
                correlationId,
            });
            return {
                statusCode: 400,
                headers,
                body: JSON.stringify({
                    error: "Missing path parameter: orderId",
                }),
            };
        }

        if (!status || typeof status !== "string") {
            logger.warn("Invalid status in updateOrder", {
                correlationId,
                status,
            });
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

            logger.info("Order status updated", {
                correlationId,
                orderId,
                status,
            });

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
                logger.warn("Order not found for update", {
                    correlationId,
                    orderId,
                });
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
        logger.error("Error updating order", {
            correlationId: getCorrelationIdFromHttpEvent(event),
            error,
        });
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
    const correlationId = getCorrelationIdFromHttpEvent(event);

    logger.info("Received get order request", {
        correlationId,
        pathParameters: event.pathParameters,
    });

    const headers = {
        "Content-Type": "application/json",
        "Access-Control-Allow-Origin": "*",
    };

    try {
        const orderId = event.pathParameters?.orderId;

        if (!orderId) {
            logger.warn("Missing orderId in getOrder", {
                correlationId,
            });
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
            logger.warn("Order not found in getOrder", {
                correlationId,
                orderId,
            });
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
        logger.error("Error fetching order", {
            correlationId: getCorrelationIdFromHttpEvent(event),
            error,
        });
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
    const correlationId = getCorrelationIdFromHttpEvent(event);

    logger.info("Received delete order request", {
        correlationId,
        pathParameters: event.pathParameters,
    });

    const headers = {
        "Content-Type": "application/json",
        "Access-Control-Allow-Origin": "*",
    };

    try {
        const orderId = event.pathParameters?.orderId;

        if (!orderId) {
            logger.warn("Missing orderId in deleteOrder", {
                correlationId,
            });
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
                logger.warn("Order not found in deleteOrder", {
                    correlationId,
                    orderId,
                });
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

        logger.info("Order deleted", {
            correlationId,
            orderId,
        });

        return {
            statusCode: 200,
            headers,
            body: JSON.stringify({
                message: "Order deleted successfully",
                orderId,
            }),
        };
    } catch (error) {
        logger.error("Error deleting order", {
            correlationId: getCorrelationIdFromHttpEvent(event),
            error,
        });
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


