const { DynamoDBClient } = require('@aws-sdk/client-dynamodb');
const { DynamoDBDocumentClient, GetCommand, UpdateCommand, PutCommand } = require('@aws-sdk/lib-dynamodb');
const { EventBridgeClient, PutEventsCommand } = require('@aws-sdk/client-eventbridge');

const dynamoClient = new DynamoDBClient({});
const docClient = DynamoDBDocumentClient.from(dynamoClient);
const eventBridgeClient = new EventBridgeClient({});

const INVENTORY_TABLE = process.env.INVENTORY_TABLE;
const ORDERS_TABLE = process.env.ORDERS_TABLE;
const EVENT_BUS_NAME = process.env.EVENT_BUS_NAME || 'default';

/**
 * Inventory Service - Consumer
 * Listens to OrderCreated events and reserves inventory
 */
exports.reserveInventory = async (event) => {
  console.log('Inventory Service: Received event', JSON.stringify(event, null, 2));

  try {
    // EventBridge sends events in Records format
    const record = event.Records?.[0] || event;
    const detail = typeof record.detail === 'string' ? JSON.parse(record.detail) : record.detail;

    const { orderId, userId, productId, quantity, version } = detail;

    if (!orderId || !productId || !quantity) {
      console.error('Inventory Service: Missing required fields in event detail');
      return;
    }

    console.log(`Inventory Service: Reserving ${quantity} units of product ${productId} for order ${orderId}`);

    // Get current inventory
    const getInventoryResult = await docClient.send(
      new GetCommand({
        TableName: INVENTORY_TABLE,
        Key: { productId },
      })
    );

    let availableQty = 0;

    if (getInventoryResult.Item) {
      availableQty = getInventoryResult.Item.availableQty || 0;
    } else {
      // Initialize inventory if it doesn't exist (for demo purposes, set to 10)
      console.log(`Inventory Service: Product ${productId} not found, initializing with 10 units`);
      await docClient.send(
        new PutCommand({
          TableName: INVENTORY_TABLE,
          Item: {
            productId,
            availableQty: 10,
            updatedAt: new Date().toISOString(),
          },
        })
      );
      availableQty = 10;
    }

    // Check if sufficient inventory
    if (availableQty < quantity) {
      console.log(`Inventory Service: Insufficient inventory for product ${productId}. Available: ${availableQty}, Required: ${quantity}`);

      // Emit InventoryFailed event
      const inventoryFailedEvent = {
        orderId,
        userId,
        productId,
        quantity,
        availableQty,
        reason: 'Insufficient inventory',
        timestamp: new Date().toISOString(),
        version: '1.0',
      };

      await eventBridgeClient.send(
        new PutEventsCommand({
          Entries: [
            {
              Source: 'eventflow.inventory',
              DetailType: 'InventoryFailed',
              Detail: JSON.stringify(inventoryFailedEvent),
              EventBusName: EVENT_BUS_NAME,
            },
          ],
        })
      );

      // Update order status to INVENTORY_FAILED
      await docClient.send(
        new UpdateCommand({
          TableName: ORDERS_TABLE,
          Key: { orderId },
          UpdateExpression: 'SET #status = :status, updatedAt = :updatedAt',
          ExpressionAttributeNames: {
            '#status': 'status',
          },
          ExpressionAttributeValues: {
            ':status': 'INVENTORY_FAILED',
            ':updatedAt': new Date().toISOString(),
          },
        })
      );

      return {
        statusCode: 200,
        body: JSON.stringify({
          message: 'Inventory reservation failed',
          orderId,
          reason: 'Insufficient inventory',
        }),
      };
    }

    // Reserve inventory (decrease available quantity)
    await docClient.send(
      new UpdateCommand({
        TableName: INVENTORY_TABLE,
        Key: { productId },
        UpdateExpression: 'SET availableQty = availableQty - :quantity, updatedAt = :updatedAt',
        ConditionExpression: 'availableQty >= :quantity',
        ExpressionAttributeValues: {
          ':quantity': quantity,
          ':updatedAt': new Date().toISOString(),
        },
      })
    );

    console.log(`Inventory Service: Successfully reserved ${quantity} units of product ${productId} for order ${orderId}`);

    // Update order status to INVENTORY_RESERVED (if not already updated by payment service)
    await docClient.send(
      new UpdateCommand({
        TableName: ORDERS_TABLE,
        Key: { orderId },
        UpdateExpression: 'SET #status = :status, updatedAt = :updatedAt',
        ConditionExpression: 'attribute_not_exists(#status) OR #status = :pendingStatus',
        ExpressionAttributeNames: {
          '#status': 'status',
        },
        ExpressionAttributeValues: {
          ':status': 'INVENTORY_RESERVED',
          ':pendingStatus': 'PENDING',
          ':updatedAt': new Date().toISOString(),
        },
      })
    ).catch((err) => {
      // Ignore if condition fails (order status already updated by payment service)
      console.log(`Inventory Service: Order ${orderId} status already updated, continuing...`);
    });

    return {
      statusCode: 200,
      body: JSON.stringify({
        message: 'Inventory reserved successfully',
        orderId,
        productId,
        quantity,
      }),
    };
  } catch (error) {
    console.error('Inventory Service: Error reserving inventory', error);

    // If it's a conditional check failure, it means insufficient inventory
    if (error.name === 'ConditionalCheckFailedException') {
      const record = event.Records?.[0] || event;
      const detail = typeof record.detail === 'string' ? JSON.parse(record.detail) : record.detail;
      const { orderId, userId, productId, quantity } = detail;

      // Emit InventoryFailed event
      await eventBridgeClient.send(
        new PutEventsCommand({
          Entries: [
            {
              Source: 'eventflow.inventory',
              DetailType: 'InventoryFailed',
              Detail: JSON.stringify({
                orderId,
                userId,
                productId,
                quantity,
                reason: 'Insufficient inventory (race condition)',
                timestamp: new Date().toISOString(),
                version: '1.0',
              }),
              EventBusName: EVENT_BUS_NAME,
            },
          ],
        })
      );
    }

    throw error;
  }
};
