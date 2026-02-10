const { DynamoDBClient } = require("@aws-sdk/client-dynamodb");
const { DynamoDBDocumentClient, PutCommand } = require("@aws-sdk/lib-dynamodb");
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
