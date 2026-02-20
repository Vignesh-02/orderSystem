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
const { createLogger, getCorrelationIdFromEventBridge } = require("../shared/logger");

const dynamoClient = new DynamoDBClient({});
const docClient = DynamoDBDocumentClient.from(dynamoClient);
const eventBridgeClient = new EventBridgeClient({});

const ORDERS_TABLE = process.env.ORDERS_TABLE;
const EVENT_BUS_NAME = process.env.EVENT_BUS_NAME || "default";

const logger = createLogger("PaymentService");

/**
 * Payment Service - Consumer
 * Listens to OrderCreated events and processes payment
 */
exports.processPayment = async (event) => {
    const record = event.Records?.[0] || event;
    const correlationId = getCorrelationIdFromEventBridge(record);

    logger.info("Received OrderCreated event", {
        correlationId,
        rawEvent: {
            id: record.id,
            source: record.source,
            "detail-type": record["detail-type"],
        },
    });

    try {
        // EventBridge sends events in Records format
        const detail =
            typeof record.detail === "string"
                ? JSON.parse(record.detail)
                : record.detail;

        const { orderId, userId, productId, quantity, version } = detail;

        if (!orderId) {
            logger.error("Missing orderId in PaymentService detail", {
                correlationId,
                detail,
            });
            return;
        }

        logger.info("Processing payment", {
            correlationId,
            orderId,
            userId,
            productId,
            quantity,
        });

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

            logger.info("Payment successful", {
                correlationId,
                orderId,
            });
        } else {
            // Payment failed - emit PaymentFailed event
            logger.warn("Payment failed", {
                correlationId,
                orderId,
            });

            const paymentFailedEvent = {
                orderId,
                userId,
                productId,
                quantity,
                reason: "Payment processing failed",
                timestamp: new Date().toISOString(),
                version: "1.0",
                correlationId,
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
        logger.error("Error processing payment", {
            correlationId: getCorrelationIdFromEventBridge(
                event.Records?.[0] || event
            ),
            error,
        });
        // In a real system, you might want to emit a PaymentFailed event here too
        throw error;
    }
};
