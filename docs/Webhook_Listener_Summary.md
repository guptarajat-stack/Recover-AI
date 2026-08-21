# Webhook Listener & Database Setup Summary

## Overview
We have successfully built the core data ingestion module for the RecoverAI pipeline. This module acts as the "Detect" stage, actively listening for failure events and storing them securely for subsequent diagnosis and recovery.

## Achievements
1. **Local Database Initialization**
   - Configured a local SQLite database (`recovery_ledger.sqlite`).
   - Created robust schemas for the `events` table (to store raw webhook payloads) and the `recovery_cases` table (to track the lifecycle and audit trail of each recovery attempt).

2. **Webhook Listener Service**
   - Built a lightweight Express.js server that exposes a `POST /webhook` endpoint.
   - The endpoint is programmed to ingest and parse four critical Razorpay revenue-risk events:
     - `payment.failed`
     - `subscription.halted`
     - `order.created` (specifically for tracking abandoned checkouts)
     - `invoice.overdue`
   - Added error handling and data extraction logic to securely normalize the incoming Razorpay payloads and insert them into the local database.

## Next Steps
With the foundation laid and data flowing into the Recovery Ledger, the pipeline is now ready for the **Diagnose** stage. We will proceed to build the Root-Cause Classifier to analyze these ingested events and categorize them appropriately.
