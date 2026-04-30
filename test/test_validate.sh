#!/bin/bash

# Set exit on error
set -e

# If the STAGE set, then it is AWS CodePipeline, otherwise local execution
if [ -z "${STAGE}" ]
then
    echo "There is no STAGE variable found."
    echo "Make sure you deployed the stack manually"
    STAGE="Dev"
else
    echo "Testing for ${STAGE} stage"
fi

STACK_NAME="${STAGE}-ApplicationStack"

# Verify stack status is CREATE_COMPLETE or UPDATE_COMPLETE
echo "Checking stack status for ${STACK_NAME}..."
STACK_STATUS=$(aws cloudformation describe-stacks --stack-name "${STACK_NAME}" --query "Stacks[0].StackStatus" --output text)
echo "Stack status: ${STACK_STATUS}"

if [ "${STACK_STATUS}" != "CREATE_COMPLETE" ] && [ "${STACK_STATUS}" != "UPDATE_COMPLETE" ]; then
    echo "ERROR: Stack ${STACK_NAME} is not in a complete state. Current status: ${STACK_STATUS}"
    exit 1
fi

# Query ALB DNS name from stack outputs
echo "Retrieving ALB DNS name from stack outputs..."
ALB_DNS=$(aws cloudformation describe-stacks --stack-name "${STACK_NAME}" --query "Stacks[0].Outputs[?OutputKey=='AlbDnsName'].OutputValue" --output text)

if [ -z "${ALB_DNS}" ] || [ "${ALB_DNS}" == "None" ]; then
    echo "ERROR: AlbDnsName output not found in stack ${STACK_NAME}"
    exit 1
fi

echo "ALB DNS Name: ${ALB_DNS}"

# HTTP health check with retry loop
MAX_RETRIES=10
RETRY_INTERVAL=30
RETRY_COUNT=0

echo "Starting HTTP health check against http://${ALB_DNS}..."

while [ ${RETRY_COUNT} -lt ${MAX_RETRIES} ]; do
    HTTP_STATUS=$(curl -s -o /dev/null -w "%{http_code}" --max-time 10 "http://${ALB_DNS}" || true)

    if [ "${HTTP_STATUS}" -ge 200 ] 2>/dev/null && [ "${HTTP_STATUS}" -lt 400 ] 2>/dev/null; then
        echo "Health check passed with HTTP status: ${HTTP_STATUS}"
        exit 0
    fi

    RETRY_COUNT=$((RETRY_COUNT + 1))
    echo "Attempt ${RETRY_COUNT}/${MAX_RETRIES}: HTTP status ${HTTP_STATUS}. Retrying in ${RETRY_INTERVAL}s..."
    sleep ${RETRY_INTERVAL}
done

echo "ERROR: Health check failed after ${MAX_RETRIES} attempts. Last HTTP status: ${HTTP_STATUS}"
exit 1
