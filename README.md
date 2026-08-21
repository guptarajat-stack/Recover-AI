# RecoverAI — Root-Cause Revenue Recovery Agent

Most failed-payment bots retry blindly. RecoverAI diagnoses **why** revenue is at risk (insufficient funds, expired mandate, checkout abandonment, overdue B2B invoice) before choosing a bounded, compliant recovery action — then proves it with a measured recovery report and a full audit trail across a test-mode transaction batch.

## Project Scope
- **Problem**: Revenue leaks through multiple channels (payment failures, checkout abandonment, failed subscriptions, overdue receivables). Each needs a different fix, not one generic retry.
- **Solution**: An agentic pipeline with five stages (Detect -> Diagnose -> Decide -> Execute -> Measure/Audit) built on Razorpay's test-mode Payments, Subscriptions, Payment Links, and Invoices APIs, driven through the `razorpay-mcp-server`.

## Core Modules
1. **Webhook Listener**: Ingests `payment.failed`, `subscription.halted`, `order.created-without-paid`, and `invoice.overdue` events.
2. **Root-Cause Classifier**: Buckets failures (e.g., insufficient funds, bank decline, expired card, mandate failure, OTP drop-off, price friction).
3. **Policy Engine**: Maps root cause to bounded intervention, enforces stopping rules (max retries, cool-off windows, discount caps, DND compliance).
4. **Execution Layer**: Creates retries, payment links, and reminders via Razorpay APIs.
5. **Recovery Ledger & Dashboard**: Logs every case, shows revenue at risk vs recovered, recovery rate by bucket, and a full audit trail.

## Architecture Description
*Note: The actual architecture diagram will be created in Day 2.*
- **Event Source**: Razorpay Webhooks (or Synthetic Test-Data Generator).
- **Ingestion**: Flask/FastAPI Webhook Listener stores raw events in the Recovery Ledger DB.
- **Classification**: Rule-based + LLM-assisted Classifier analyzes Razorpay error codes, payment metadata, and history to assign a root-cause bucket.
- **Decision**: Policy Engine reads the root cause and evaluates against configured stopping rules (JSON config) to determine the next best action.
- **Execution**: LLM Agent uses `razorpay-mcp-server` to perform the determined action (e.g., generate a Payment Link) and notify the customer via simulated channels (SMTP/WhatsApp sandbox).
- **Measurement**: Dashboard reads from the Recovery Ledger to visualize metrics.

## Setup Instructions
1. Run `razorpay-mcp-server` locally.
2. Provide your Razorpay Test Mode API keys in `.env`.
3. Start the Webhook Listener: `node src/server.js`

## Project Updates
- [Webhook Listener & Database Setup Summary](./docs/Webhook_Listener_Summary.pdf)
- [Root-Cause Classifier Summary](./docs/Root_Cause_Classifier_Summary.pdf)
- [Policy Engine Summary](./docs/Policy_Engine_Summary.pdf)
