const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

// Configuration
const NUM_EVENTS = 75;
const DATA_DIR = path.join(__dirname, '..', 'data');
const OUTPUT_FILE = path.join(DATA_DIR, 'mock_events.json');

// Error mappings for root causes
const PAYMENT_FAILED_REASONS = [
    { code: "BAD_REQUEST_ERROR", description: "Payment failed due to insufficient funds", bucket: "insufficient_funds" },
    { code: "GATEWAY_ERROR", description: "Payment declined by the issuing bank", bucket: "bank_decline" },
    { code: "BAD_REQUEST_ERROR", description: "Card is expired", bucket: "expired_card" },
    { code: "BAD_REQUEST_ERROR", description: "OTP drop-off or cancelled by user", bucket: "abandoned_checkout" }
];

function generateId(prefix) {
    return `${prefix}_${crypto.randomBytes(7).toString('hex')}`;
}

function generateTimestamp() {
    // Random time in the last 7 days
    const now = Date.now();
    const daysAgo = Math.floor(Math.random() * 7);
    const hoursAgo = Math.floor(Math.random() * 24);
    const delta = (daysAgo * 24 * 60 * 60 * 1000) + (hoursAgo * 60 * 60 * 1000);
    return Math.floor((now - delta) / 1000); // Unix timestamp in seconds
}

function getRandomInt(min, max) {
    return Math.floor(Math.random() * (max - min + 1)) + min;
}

function generatePaymentFailed() {
    const reason = PAYMENT_FAILED_REASONS[Math.floor(Math.random() * PAYMENT_FAILED_REASONS.length)];
    return {
        event: "payment.failed",
        created_at: generateTimestamp(),
        payload: {
            payment: {
                entity: {
                    id: generateId('pay'),
                    entity: "payment",
                    amount: getRandomInt(50000, 500000), // 500 to 5000 INR
                    currency: "INR",
                    status: "failed",
                    order_id: generateId('order'),
                    error_code: reason.code,
                    error_description: reason.description,
                    email: `customer_${getRandomInt(1, 1000)}@example.com`,
                    contact: `+9198765${getRandomInt(10000, 99999)}`
                }
            }
        }
    };
}

function generateSubscriptionHalted() {
    return {
        event: "subscription.halted",
        created_at: generateTimestamp(),
        payload: {
            subscription: {
                entity: {
                    id: generateId('sub'),
                    entity: "subscription",
                    plan_id: generateId('plan'),
                    status: "halted",
                    customer_id: generateId('cust'),
                    notes: {
                        error_description: "Mandate execution failed due to insufficient balance"
                    }
                }
            }
        }
    };
}

function generateOrderCreatedAbandoned() {
    return {
        event: "order.created",
        created_at: generateTimestamp(),
        payload: {
            order: {
                entity: {
                    id: generateId('order'),
                    entity: "order",
                    amount: getRandomInt(100000, 1000000),
                    amount_paid: 0,
                    amount_due: getRandomInt(100000, 1000000),
                    currency: "INR",
                    receipt: `receipt_${getRandomInt(1000, 9999)}`,
                    status: "created"
                }
            }
        }
    };
}

function generateInvoiceOverdue() {
    return {
        event: "invoice.overdue",
        created_at: generateTimestamp(),
        payload: {
            invoice: {
                entity: {
                    id: generateId('inv'),
                    entity: "invoice",
                    amount: getRandomInt(500000, 5000000),
                    currency: "INR",
                    status: "overdue",
                    customer_details: {
                        email: `b2b_${getRandomInt(1, 100)}@company.com`,
                        contact: `+9198765${getRandomInt(10000, 99999)}`
                    }
                }
            }
        }
    };
}

function main() {
    if (!fs.existsSync(DATA_DIR)) {
        fs.mkdirSync(DATA_DIR, { recursive: true });
    }
    
    const events = [];
    const generators = [
        generatePaymentFailed,
        generateSubscriptionHalted,
        generateOrderCreatedAbandoned,
        generateInvoiceOverdue
    ];
    
    for (let i = 0; i < NUM_EVENTS; i++) {
        const generator = generators[Math.floor(Math.random() * generators.length)];
        events.push(generator());
    }
    
    // Sort by created_at chronological
    events.sort((a, b) => a.created_at - b.created_at);
    
    fs.writeFileSync(OUTPUT_FILE, JSON.stringify(events, null, 2));
    
    console.log(`✅ Generated ${NUM_EVENTS} synthetic events and saved to ${OUTPUT_FILE}`);
    
    const summary = {};
    events.forEach(ev => {
        summary[ev.event] = (summary[ev.event] || 0) + 1;
    });
    
    console.log("\nEvent Summary:");
    for (const [event_name, count] of Object.entries(summary)) {
        console.log(` - ${event_name}: ${count}`);
    }
}

main();
