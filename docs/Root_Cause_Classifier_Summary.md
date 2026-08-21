# Root-Cause Classifier Summary

## Overview
We have successfully built the **Diagnose** stage of the RecoverAI pipeline: the Root-Cause Classifier. This module acts as the intelligence layer that sits between event ingestion and policy execution, ensuring that we don't just blindly retry failed payments, but instead understand *why* they failed.

## Achievements
1. **Rule-Based Classification Engine (`src/classifier.js`)**
   - Developed a Node.js module that pulls unprocessed events from the SQLite `events` table.
   - Implemented logic to parse Razorpay `error_code` and `error_description` alongside payment metadata.
   - Accurately buckets events into actionable categories:
     - `insufficient_funds`
     - `bank_decline`
     - `expired_card`
     - `abandoned_checkout`
     - `mandate_failure`
     - `overdue_invoice`

2. **Recovery Case Generation & Audit Logging**
   - For every classified event, a new tracking record is created in the `recovery_cases` table.
   - Established the foundational **Audit Trail**: Every case is initialized with a JSON audit log detailing the ingestion timestamp, the assigned root-cause bucket, and the classification confidence score.
   - Successfully ran a test batch of 75 synthetic events through the classifier, achieving 100% categorization.

## Next Steps
With our failed transactions now properly diagnosed and categorized into buckets, the pipeline is ready for the **Decide** stage. We will proceed to build the Policy Engine, which will map these root-cause buckets to specific recovery interventions (e.g., retries, payment links, discounts) based on strict stopping rules.
