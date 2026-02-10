# EventFlow – Event-Driven Order Processing System

A production-ready, event-driven microservices architecture using Amazon EventBridge, demonstrating loose coupling, scalability, and fault isolation.

## 🏗️ Architecture

```
Client
  ↓
API Gateway
  ↓
OrderService (Lambda) - Producer
  ↓ emits event →
EventBridge (Default Bus)
  ├── PaymentService (Lambda) - Consumer
  ├── InventoryService (Lambda) - Consumer
  └── NotificationService (Lambda) - Consumer
```

## 🧠 Core Principles

-   **Loose Coupling**: Services only communicate via events, never direct calls
-   **Scalability**: Each service scales independently
-   **Fault Isolation**: One service failure doesn't break others
-   **Extensibility**: Add new services without touching existing code
-   **Schema Evolution**: Versioned event contracts for backward compatibility

## 🟢 AWS Services (All Free Tier Safe)

-   **AWS Lambda**: Serverless compute
-   **Amazon EventBridge**: Event routing and filtering
-   **API Gateway**: HTTP entry point
-   **DynamoDB**: NoSQL database (on-demand billing)
-   **CloudWatch**: Logging and monitoring
-   **IAM**: Security and permissions

## 📦 Microservices

### 1. Order Service (Producer)

-   **Trigger**: HTTP POST via API Gateway
-   **Responsibility**:
    -   Accept order requests
    -   Store order in DynamoDB
    -   Emit `OrderCreated` event to EventBridge
-   **DynamoDB Table**: `OrdersTable`
    -   PK: `orderId`
    -   Attributes: `userId`, `productId`, `quantity`, `status`, `createdAt`, `updatedAt`

### 2. Payment Service (Consumer)

-   **Trigger**: EventBridge rule listening to `OrderCreated` events
-   **Responsibility**:
    -   Simulate payment processing (90% success rate)
    -   Update order status to `PAID` or `PAYMENT_FAILED`
    -   Emit `PaymentFailed` event on failure

### 3. Inventory Service (Consumer)

-   **Trigger**: EventBridge rule listening to `OrderCreated` events
-   **Responsibility**:
    -   Reserve inventory for the order
    -   Validate stock availability
    -   Emit `InventoryFailed` event if insufficient stock
-   **DynamoDB Table**: `InventoryTable`
    -   PK: `productId`
    -   Attributes: `availableQty`, `updatedAt`

### 4. Notification Service (Consumer)

-   **Trigger**: Multiple EventBridge rules for:
    -   `OrderCreated`
    -   `PaymentFailed`
    -   `InventoryFailed`
-   **Responsibility**:
    -   Send notifications (currently logs to CloudWatch)
    -   Handles all event types gracefully

## 🔁 Event Flow

```
OrderCreated Event
  ├─→ PaymentService (processes payment)
  ├─→ InventoryService (reserves stock)
  └─→ NotificationService (sends notification)

PaymentFailed Event
  └─→ NotificationService (notifies user)

InventoryFailed Event
  └─→ NotificationService (notifies user)
```

## 📋 Event Schema

### OrderCreated Event

```json
{
    "source": "eventflow.orders",
    "detail-type": "OrderCreated",
    "detail": {
        "orderId": "ord-123",
        "userId": "user-42",
        "productId": "prod-9",
        "quantity": 2,
        "timestamp": "2026-01-13T10:00:00Z",
        "version": "1.0"
    }
}
```

### PaymentFailed Event

```json
{
    "source": "eventflow.payment",
    "detail-type": "PaymentFailed",
    "detail": {
        "orderId": "ord-123",
        "userId": "user-42",
        "productId": "prod-9",
        "quantity": 2,
        "reason": "Payment processing failed",
        "timestamp": "2026-01-13T10:00:00Z",
        "version": "1.0"
    }
}
```

### InventoryFailed Event

```json
{
    "source": "eventflow.inventory",
    "detail-type": "InventoryFailed",
    "detail": {
        "orderId": "ord-123",
        "userId": "user-42",
        "productId": "prod-9",
        "quantity": 2,
        "availableQty": 1,
        "reason": "Insufficient inventory",
        "timestamp": "2026-01-13T10:00:00Z",
        "version": "1.0"
    }
}
```

## 🚀 Getting Started

### Prerequisites

-   Node.js 20.x or higher
-   AWS CLI configured with appropriate credentials
-   Serverless Framework CLI installed globally

### Installation

1. **Install dependencies:**

    ```bash
    npm install
    ```

2. **Deploy to AWS:**

    ```bash
    npm run deploy
    ```

    Or deploy to a specific stage:

    ```bash
    npm run deploy:dev
    ```

3. **Get the API Gateway URL:**
   After deployment, the API Gateway URL will be displayed in the output. It will look like:
    ```
    https://xxxxx.execute-api.us-east-1.amazonaws.com/dev
    ```

### Testing

1. **Create an order:**

    ```bash
    curl -X POST https://YOUR_API_GATEWAY_URL/dev/orders \
      -H "Content-Type: application/json" \
      -d '{
        "userId": "user-123",
        "productId": "prod-456",
        "quantity": 2
      }'
    ```

2. **Check CloudWatch Logs:**

    ```bash
    # Order Service logs
    npm run logs -- -f createOrder --tail

    # Payment Service logs
    npm run logs -- -f processPayment --tail

    # Inventory Service logs
    npm run logs -- -f reserveInventory --tail

    # Notification Service logs
    npm run logs -- -f sendNotification --tail
    ```

3. **Query DynamoDB:**

    ```bash
    # Get order
    aws dynamodb get-item \
      --table-name eventflow-order-system-orders-dev \
      --key '{"orderId": {"S": "ord-xxxxx"}}'

    # Get inventory
    aws dynamodb get-item \
      --table-name eventflow-order-system-inventory-dev \
      --key '{"productId": {"S": "prod-456"}}'
    ```

## 🧪 Failure Scenarios

The system is designed to handle failures gracefully:

| Scenario             | What Happens                                      |
| -------------------- | ------------------------------------------------- |
| Payment fails        | Inventory service still runs independently        |
| Inventory fails      | Payment service still processes (if it succeeded) |
| Notification fails   | Business logic continues unaffected               |
| One Lambda throttles | Other Lambdas continue processing                 |

## 🔐 IAM Permissions

Each Lambda has minimal, least-privilege permissions:

-   **Order Service**: Can write to OrdersTable and emit events
-   **Payment Service**: Can update OrdersTable and emit events
-   **Inventory Service**: Can read/write InventoryTable, update OrdersTable, and emit events
-   **Notification Service**: Read-only (just logs events)

## 📊 Observability

-   **CloudWatch Logs**: All Lambda functions log to CloudWatch
-   **EventBridge Metrics**: Available in CloudWatch Metrics
-   **DynamoDB Metrics**: Table metrics in CloudWatch

## 🎯 Key Learnings

After working with this project, you'll understand:

-   ✅ Why event-driven systems scale better
-   ✅ EventBridge vs SNS vs SQS use cases
-   ✅ How to design loosely coupled microservices
-   ✅ How failures propagate (or don't) in event-driven systems
-   ✅ How to add new services without refactoring existing code
-   ✅ Schema evolution and versioning strategies

## 🔄 Extending the System

To add a new service (e.g., FraudDetectionService):

1. Create a new Lambda function in `src/fraud-detection-service/`
2. Add it to `serverless.yml` with an EventBridge trigger
3. Deploy - no changes needed to existing services!

Example:

```yaml
detectFraud:
    handler: src/fraud-detection-service/handler.detectFraud
    events:
        - eventBridge:
              pattern:
                  source:
                      - eventflow.orders
                  detail-type:
                      - OrderCreated
```

## 🧹 Cleanup

To remove all AWS resources:

```bash
npm run remove
```

Or for a specific stage:

```bash
serverless remove --stage dev
```

## 📝 Notes

-   All services use the EventBridge **default bus** (free tier)
-   DynamoDB uses **on-demand billing** (free tier eligible)
-   Lambda functions use 256MB memory and 30s timeout
-   Event versioning (`version: "1.0"`) allows for schema evolution

## 🐛 Troubleshooting

1. **Events not triggering**: Check EventBridge rules in AWS Console
2. **Permission errors**: Verify IAM roles have correct permissions
3. **DynamoDB errors**: Ensure tables are created (check CloudFormation stack)
4. **API Gateway CORS**: CORS is enabled by default in the configuration

## 📚 Additional Resources

-   [Amazon EventBridge Documentation](https://docs.aws.amazon.com/eventbridge/)
-   [Serverless Framework Documentation](https://www.serverless.com/framework/docs)
-   [AWS Lambda Best Practices](https://docs.aws.amazon.com/lambda/latest/dg/best-practices.html)

---

**Built with ❤️ using AWS Serverless Architecture**
