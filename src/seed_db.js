const fs = require('fs');
const path = require('path');
const db = require('./db');
const { v4: uuidv4 } = require('uuid');

const mockEventsPath = path.join(__dirname, '..', 'data', 'mock_events.json');

if (!fs.existsSync(mockEventsPath)) {
    console.error("Mock events file not found!");
    process.exit(1);
}

const events = JSON.parse(fs.readFileSync(mockEventsPath, 'utf8'));

console.log(`Read ${events.length} events from mock_events.json`);

db.serialize(() => {
    db.run("BEGIN TRANSACTION");

    const insertStmt = db.prepare(`
        INSERT INTO events (
            id, razorpay_event_id, event_type, entity_id, amount, currency, 
            customer_id, customer_contact, error_code, error_description, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    let count = 0;
    events.forEach(payload => {
        const id = uuidv4();
        const eventType = payload.event;
        const createdAt = payload.created_at;
        
        let entityId, amount, currency, customerId, customerContact, errorCode, errorDesc;

        if (eventType === 'payment.failed') {
            const payment = payload.payload.payment.entity;
            entityId = payment.id;
            amount = payment.amount;
            currency = payment.currency;
            customerId = payment.customer_id || null;
            customerContact = payment.contact || payment.email || null;
            errorCode = payment.error_code;
            errorDesc = payment.error_description;
        } 
        else if (eventType === 'subscription.halted') {
            const sub = payload.payload.subscription.entity;
            entityId = sub.id;
            amount = 0; 
            currency = 'INR';
            customerId = sub.customer_id;
            customerContact = null;
            errorCode = 'MANDATE_FAILURE';
            errorDesc = sub.notes ? sub.notes.error_description : 'Mandate halted';
        }
        else if (eventType === 'order.created') {
            const order = payload.payload.order.entity;
            entityId = order.id;
            amount = order.amount;
            currency = order.currency;
            customerId = null;
            customerContact = null;
            errorCode = 'ABANDONED_CHECKOUT';
            errorDesc = 'Order created but not paid';
        }
        else if (eventType === 'invoice.overdue') {
            const inv = payload.payload.invoice.entity;
            entityId = inv.id;
            amount = inv.amount;
            currency = inv.currency;
            customerId = inv.customer_id || null;
            customerContact = inv.customer_details ? (inv.customer_details.contact || inv.customer_details.email) : null;
            errorCode = 'OVERDUE';
            errorDesc = 'Invoice is overdue';
        }

        insertStmt.run([
            id, null, eventType, entityId, amount, currency,
            customerId, customerContact, errorCode, errorDesc, createdAt
        ]);
        count++;
    });

    insertStmt.finalize();

    db.run("COMMIT", (err) => {
        if (err) {
            console.error("Failed to seed database:", err.message);
        } else {
            console.log(`✅ Successfully seeded ${count} events into the database.`);
        }
    });
});

setTimeout(() => {
    db.close();
}, 2000);
