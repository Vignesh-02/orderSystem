const { DynamoDBClient } = require("@aws-sdk/client-dynamodb");
const {
    DynamoDBDocumentClient,
    GetCommand,
    UpdateCommand,
} = require("@aws-sdk/lib-dynamodb");
const {
    EventBridgeClient,
    PutEventsCommand,
} = require("@aws-sdk/client-eventbridge");

const dynamoClient = new DynamoDBClient({});
const docClient = DynamoDBDocumentClient.from(dynamoClient);
const eventBridgeClient = new EventBridgeClient({});

const ORDERS_TABLE = process.env.ORDERS_TABLE;
const EVENT_BUS_NAME = process.env.EVENT_BUS_NAME || "default";

/**
 * Payment Service - Consumer
 * Listens to OrderCreated events and processes payment
 */
exports.processPayment = async (event) => {
    console.log(
        "Payment Service: Received event",
        JSON.stringify(event, null, 2)
    );

    try {
        // EventBridge sends events in Records format
        const record = event.Records?.[0] || event;
        const detail =
            typeof record.detail === "string"
                ? JSON.parse(record.detail)
                : record.detail;

        const { orderId, userId, productId, quantity, version } = detail;

        if (!orderId) {
            console.error("Payment Service: Missing orderId in event detail");
            return;
        }

        console.log(`Payment Service: Processing payment for order ${orderId}`);

        // Simulate payment processing (90% success rate for demo)
        const paymentSuccess = Math.random() > 0.1;

        if (paymentSuccess) {
            // Update order status to PAID
            await docClient.send(
                new UpdateCommand({
                    TableName: ORDERS_TABLE,
                    Key: { orderId },
                    UpdateExpression:
                        "SET #status = :status, updatedAt = :updatedAt",
                    ExpressionAttributeNames: {
                        "#status": "status",
                    },
                    ExpressionAttributeValues: {
                        ":status": "PAID",
                        ":updatedAt": new Date().toISOString(),
                    },
                })
            );

            console.log(
                `Payment Service: Payment successful for order ${orderId}`
            );
        } else {
            // Payment failed - emit PaymentFailed event
            console.log(`Payment Service: Payment failed for order ${orderId}`);

            const paymentFailedEvent = {
                orderId,
                userId,
                productId,
                quantity,
                reason: "Payment processing failed",
                timestamp: new Date().toISOString(),
                version: "1.0",
            };

            await eventBridgeClient.send(
                new PutEventsCommand({
                    Entries: [
                        {
                            Source: "eventflow.payment",
                            DetailType: "PaymentFailed",
                            Detail: JSON.stringify(paymentFailedEvent),
                            EventBusName: EVENT_BUS_NAME,
                        },
                    ],
                })
            );

            // Update order status to PAYMENT_FAILED
            await docClient.send(
                new UpdateCommand({
                    TableName: ORDERS_TABLE,
                    Key: { orderId },
                    UpdateExpression:
                        "SET #status = :status, updatedAt = :updatedAt",
                    ExpressionAttributeNames: {
                        "#status": "status",
                    },
                    ExpressionAttributeValues: {
                        ":status": "PAYMENT_FAILED",
                        ":updatedAt": new Date().toISOString(),
                    },
                })
            );
        }

        return {
            statusCode: 200,
            body: JSON.stringify({
                message: paymentSuccess
                    ? "Payment processed successfully"
                    : "Payment failed",
                orderId,
            }),
        };
    } catch (error) {
        console.error("Payment Service: Error processing payment", error);
        // In a real system, you might want to emit a PaymentFailed event here too
        throw error;
    }
};
