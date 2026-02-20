const { SESClient, SendEmailCommand } = require("@aws-sdk/client-ses");
const {
    createLogger,
    getCorrelationIdFromEventBridge,
} = require("../shared/logger");

const sesClient = new SESClient({});

const FROM_EMAIL = process.env.FROM_EMAIL || "noreply@example.com";
const TO_EMAIL = process.env.TO_EMAIL || "user@example.com";

const logger = createLogger("NotificationService");

/**
 * Notification Service - Consumer
 * Listens to multiple event types and sends notifications via SES
 */
exports.sendNotification = async (event) => {
    const record = event.Records?.[0] || event;
    const correlationId = getCorrelationIdFromEventBridge(record);

    logger.info("Received event for notification", {
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
        const source = record.source || "unknown";
        const detailType =
            record["detail-type"] || record.detailType || "unknown";

        const { orderId, userId, productId, quantity, reason, version } =
            detail;

        let notificationMessage = "";
        let notificationType = "INFO";

        // Handle different event types
        switch (detailType) {
            case "OrderCreated":
                notificationMessage = `📦 Order Created: Order ${orderId} has been created for user ${userId}. Product: ${productId}, Quantity: ${quantity}`;
                notificationType = "SUCCESS";
                break;

            case "PaymentFailed":
                notificationMessage = `💳 Payment Failed: Order ${orderId} payment processing failed. Reason: ${
                    reason || "Unknown"
                }`;
                notificationType = "ERROR";
                break;

            case "InventoryFailed":
                notificationMessage = `📦 Inventory Failed: Order ${orderId} cannot be fulfilled. Product: ${productId}, Required: ${quantity}, Reason: ${
                    reason || "Insufficient stock"
                }`;
                notificationType = "WARNING";
                break;

            default:
                notificationMessage = `ℹ️ Event Received: ${detailType} for order ${
                    orderId || "N/A"
                }`;
        }

        // Structured log for notification
        logger.info("Prepared notification", {
            correlationId,
            notificationType,
            notificationMessage,
            source,
            detailType,
            orderId: orderId || "N/A",
            userId: userId || "N/A",
            productId: productId || "N/A",
            quantity: quantity || "N/A",
        });

        // Send email via SES
        const emailSubject = `EventFlow Notification: ${detailType}`;
        const emailBody = `
Hello,

${notificationMessage}

Event Details:
- Source: ${source}
- Detail Type: ${detailType}
- Order ID: ${orderId || "N/A"}
- User ID: ${userId || "N/A"}
- Product ID: ${productId || "N/A"}
- Quantity: ${quantity || "N/A"}
- Timestamp: ${new Date().toISOString()}
${reason ? `- Reason: ${reason}` : ""}

This is an automated notification from EventFlow Order Processing System.

Best regards,
EventFlow System
        `.trim();

        try {
            const sendEmailCommand = new SendEmailCommand({
                Source: FROM_EMAIL,
                Destination: {
                    ToAddresses: [TO_EMAIL],
                },
                Message: {
                    Subject: {
                        Data: emailSubject,
                        Charset: "UTF-8",
                    },
                    Body: {
                        Text: {
                            Data: emailBody,
                            Charset: "UTF-8",
                        },
                        Html: {
                            Data: `
                                <html>
                                    <body>
                                        <h2>EventFlow Notification: ${detailType}</h2>
                                        <p>${notificationMessage}</p>
                                        <hr>
                                        <h3>Event Details:</h3>
                                        <ul>
                                            <li><strong>Source:</strong> ${source}</li>
                                            <li><strong>Detail Type:</strong> ${detailType}</li>
                                            <li><strong>Order ID:</strong> ${
                                                orderId || "N/A"
                                            }</li>
                                            <li><strong>User ID:</strong> ${
                                                userId || "N/A"
                                            }</li>
                                            <li><strong>Product ID:</strong> ${
                                                productId || "N/A"
                                            }</li>
                                            <li><strong>Quantity:</strong> ${
                                                quantity || "N/A"
                                            }</li>
                                            <li><strong>Timestamp:</strong> ${new Date().toISOString()}</li>
                                            ${
                                                reason
                                                    ? `<li><strong>Reason:</strong> ${reason}</li>`
                                                    : ""
                                            }
                                        </ul>
                                        <hr>
                                        <p><em>This is an automated notification from EventFlow Order Processing System.</em></p>
                                    </body>
                                </html>
                            `,
                            Charset: "UTF-8",
                        },
                    },
                },
            });

            const emailResponse = await sesClient.send(sendEmailCommand);
            logger.info("Email sent via SES", {
                correlationId,
                messageId: emailResponse.MessageId,
            });
        } catch (emailError) {
            // Log email error but don't fail the notification service
            // This ensures notification failures don't break the system
            logger.error("Failed to send email via SES", {
                correlationId,
                error: emailError,
            });

            // Common SES errors:
            // - Email address not verified (in sandbox mode)
            // - Rate limit exceeded
            // - Invalid email format
            // In production, you might want to retry or use a dead letter queue
        }

        return {
            statusCode: 200,
            body: JSON.stringify({
                message: "Notification sent successfully",
                notificationType,
                orderId: orderId || "N/A",
            }),
        };
    } catch (error) {
        logger.error("Error in NotificationService", {
            correlationId: getCorrelationIdFromEventBridge(
                event.Records?.[0] || event
            ),
            error,
        });
        // Notification failures should not break the system
        // Just log and continue
        return {
            statusCode: 200,
            body: JSON.stringify({
                message:
                    "Notification service encountered an error but did not fail",
                error: error.message,
            }),
        };
    }
};
