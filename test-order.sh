#!/bin/bash

# Test script for EventFlow Order System
# Usage: ./test-order.sh <API_GATEWAY_URL> [userId] [productId] [quantity]

API_URL="${1:-http://localhost:3000}"
USER_ID="${2:-user-123}"
PRODUCT_ID="${3:-prod-456}"
QUANTITY="${4:-2}"

echo "🚀 Testing EventFlow Order System"
echo "=================================="
echo "API URL: $API_URL"
echo "User ID: $USER_ID"
echo "Product ID: $PRODUCT_ID"
echo "Quantity: $QUANTITY"
echo ""

# Create an order
echo "📦 Creating order..."
RESPONSE=$(curl -s -X POST "$API_URL/orders" \
  -H "Content-Type: application/json" \
  -d "{
    \"userId\": \"$USER_ID\",
    \"productId\": \"$PRODUCT_ID\",
    \"quantity\": $QUANTITY
  }")

echo "Response:"
echo "$RESPONSE" | jq '.' 2>/dev/null || echo "$RESPONSE"
echo ""

# Extract order ID if available
ORDER_ID=$(echo "$RESPONSE" | jq -r '.orderId' 2>/dev/null)

if [ "$ORDER_ID" != "null" ] && [ -n "$ORDER_ID" ]; then
  echo "✅ Order created: $ORDER_ID"
  echo ""
  echo "📊 Next steps:"
  echo "1. Check CloudWatch logs for all services:"
  echo "   - Order Service: serverless logs -f createOrder --tail"
  echo "   - Payment Service: serverless logs -f processPayment --tail"
  echo "   - Inventory Service: serverless logs -f reserveInventory --tail"
  echo "   - Notification Service: serverless logs -f sendNotification --tail"
  echo ""
  echo "2. Check order status in DynamoDB:"
  echo "   aws dynamodb get-item --table-name eventflow-order-system-orders-dev --key '{\"orderId\": {\"S\": \"$ORDER_ID\"}}'"
else
  echo "❌ Failed to create order"
  exit 1
fi
