require('dotenv').config();
const express = require('express');
const bodyParser = require('body-parser');
const { v4: uuidv4 } = require('uuid');
const db = require('./db');

const app = express();
app.use(bodyParser.json());

const PORT = process.env.PORT || 3000;

app.post('/webhook', (req, res) => {
    const payload = req.body;
    const eventType = payload.event;
    
    // We only care about specific events
    const supportedEvents = [
        'payment.failed', 
        'subscription.halted', 
        'order.created', 
        'invoice.overdue'
    ];
    
    if (!supportedEvents.includes(eventType)) {
        return res.status(200).json({ status: 'ignored', message: 'Event type not monitored' });
    }

    try {
        const id = uuidv4();
        let entityId, amount, currency, customerId, customerContact, errorCode, errorDesc;
        const createdAt = payload.created_at || Math.floor(Date.now() / 1000);
        let razorpayEventId = null; // Sometimes test payloads don't have this wrapper

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
            amount = 0; // Might need to fetch plan details later
            currency = 'INR';
            customerId = sub.customer_id;
            customerContact = null;
            errorCode = 'MANDATE_FAILURE';
            errorDesc = sub.notes ? sub.notes.error_description : 'Mandate halted';
        }
        else if (eventType === 'order.created') {
            const order = payload.payload.order.entity;
            // Only care if it's abandoned, but webhook listener just ingests it.
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

        const insertQuery = `
            INSERT INTO events (
                id, razorpay_event_id, event_type, entity_id, amount, currency, 
                customer_id, customer_contact, error_code, error_description, created_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `;

        db.run(insertQuery, [
            id, razorpayEventId, eventType, entityId, amount, currency,
            customerId, customerContact, errorCode, errorDesc, createdAt
        ], function(err) {
            if (err) {
                console.error("Failed to insert event:", err.message);
                return res.status(500).json({ status: 'error', message: 'Database error' });
            }
            console.log(`📥 Ingested ${eventType} for entity ${entityId}`);
            res.status(200).json({ status: 'ok', id: id });
        });

    } catch (err) {
        console.error("Error processing webhook payload:", err);
        res.status(400).json({ status: 'error', message: 'Invalid payload structure' });
    }
});

app.listen(PORT, () => {
    console.log(`🚀 Webhook Listener running on http://localhost:${PORT}`);
});
