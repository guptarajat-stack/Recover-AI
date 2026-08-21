# Data Schemas & Stopping Rules Config

## 1. Data Schemas

We will store our events and recovery cases in a local SQLite/PostgreSQL database (the "Recovery Ledger"). Below is the schema structure.

### `events` Table
Stores raw webhooks received from Razorpay (or generated synthetically).
- `id` (String, UUID) - Primary Key
- `razorpay_event_id` (String) - ID from the Razorpay webhook payload
- `event_type` (String) - e.g., `payment.failed`, `subscription.halted`
- `entity_id` (String) - The ID of the payment, subscription, or order
- `amount` (Integer) - Amount in paise
- `currency` (String) - e.g., `INR`
- `customer_id` (String) - Razorpay customer ID
- `customer_contact` (String) - Email or Phone number
- `error_code` (String) - e.g., `BAD_REQUEST_ERROR`
- `error_description` (String) - e.g., `Payment failed due to insufficient funds`
- `created_at` (Timestamp)
- `processed` (Boolean) - Whether the pipeline has picked it up

### `recovery_cases` Table
Tracks the end-to-end recovery lifecycle of a failed entity.
- `id` (String, UUID) - Primary Key
- `event_id` (String) - Foreign Key to `events.id`
- `root_cause_bucket` (String) - e.g., `insufficient_funds`, `abandoned_checkout`
- `intervention_type` (String) - e.g., `create_payment_link`, `retry_charge`
- `status` (String) - e.g., `pending`, `action_taken`, `recovered`, `failed_to_recover`, `dnd_skipped`
- `attempts` (Integer) - Number of retry attempts made
- `revenue_at_risk` (Integer) - Amount in paise
- `revenue_recovered` (Integer) - Amount recovered in paise (0 if not recovered)
- `audit_trail` (JSON) - Array of timestamps and actions taken
- `created_at` (Timestamp)
- `updated_at` (Timestamp)

---

## 2. Stopping Rules Configuration (`config/stopping_rules.json`)

The Policy Engine will read this configuration to decide *how far* it can go for a specific root-cause bucket.

```json
{
  "buckets": {
    "insufficient_funds": {
      "action": "wait_and_retry",
      "max_attempts": 3,
      "cool_off_hours": 24,
      "dnd_compliance_required": false
    },
    "bank_decline": {
      "action": "send_payment_link_with_alt_method",
      "max_attempts": 1,
      "cool_off_hours": 0,
      "dnd_compliance_required": true
    },
    "abandoned_checkout": {
      "action": "send_discounted_payment_link",
      "max_attempts": 2,
      "cool_off_hours": 2,
      "max_discount_percentage": 10,
      "dnd_compliance_required": true
    },
    "mandate_failure": {
      "action": "notify_and_recreate_mandate",
      "max_attempts": 1,
      "cool_off_hours": 0,
      "dnd_compliance_required": false
    },
    "overdue_invoice": {
      "action": "promise_to_pay_tracker",
      "max_attempts": 5,
      "cool_off_hours": 48,
      "dnd_compliance_required": false
    }
  },
  "global_rules": {
    "do_not_disturb_hours": {
      "start": "21:00",
      "end": "08:00",
      "timezone": "Asia/Kolkata"
    }
  }
}
```
