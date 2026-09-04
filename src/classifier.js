const db = require('./db');
const { v4: uuidv4 } = require('uuid');

// Basic rule-based classifier for Razorpay errors
function classifyEvent(event) {
    const { event_type, error_code } = event;
    let bucket = 'unknown';
    let confidence = 0;

    if (event_type === 'payment.failed') {
        if (error_code === 'BAD_REQUEST_ERROR' && event.error_description?.toLowerCase().includes('insufficient')) {
            bucket = 'insufficient_funds';
            confidence = 0.95;
        } else if (error_code === 'GATEWAY_ERROR') {
            bucket = 'bank_decline';
            confidence = 0.90;
        } else if (error_code === 'BAD_REQUEST_ERROR' && event.error_description?.toLowerCase().includes('expired')) {
            bucket = 'expired_card';
            confidence = 0.95;
        } else if (error_code === 'BAD_REQUEST_ERROR' && event.error_description?.toLowerCase().includes('cancelled')) {
            bucket = 'abandoned_checkout';
            confidence = 0.85;
        } else {
            // Fallback for general payment failures
            bucket = 'bank_decline';
            confidence = 0.60;
        }
    } else if (event_type === 'subscription.halted') {
        bucket = 'mandate_failure';
        confidence = 0.98;
    } else if (event_type === 'order.created') {
        bucket = 'abandoned_checkout';
        confidence = 0.80; // We assume if it's fed to the pipeline as an issue, it's abandoned
    } else if (event_type === 'invoice.overdue') {
        bucket = 'overdue_invoice';
        confidence = 0.99;
    }

    return { bucket, confidence };
}

async function processPendingEvents() {
    console.log("🔍 Running Root-Cause Classifier on pending events...");
    
    const { data: rows, error: fetchErr } = await db.from('events').select('*').eq('processed', false);

    if (fetchErr) {
        console.error("Error fetching pending events:", fetchErr.message);
        return;
    }

    if (!rows || rows.length === 0) {
        console.log("No pending events found.");
        return;
    }

    console.log(`Found ${rows.length} pending events to classify.`);

    const caseRows = [];
    const eventIdsToUpdate = [];

    rows.forEach((event) => {
        const classification = classifyEvent(event);
        const caseId = uuidv4();
        const now = new Date().toISOString();
        
        const auditLog = [
            { 
                timestamp: Math.floor(Date.now() / 1000), 
                action: 'event_ingested', 
                details: `Event ${event.event_type} received` 
            },
            { 
                timestamp: Math.floor(Date.now() / 1000), 
                action: 'root_cause_classified', 
                details: `Classified as ${classification.bucket} with ${Math.round(classification.confidence * 100)}% confidence` 
            }
        ];

        caseRows.push({
            id: caseId,
            event_id: event.id,
            root_cause_bucket: classification.bucket,
            status: 'diagnosed', // Updated to match Supabase ENUM
            revenue_at_risk: event.amount,
            classification_confidence: classification.confidence,
            audit_trail: auditLog,
            created_at: now,
            updated_at: now
        });
        
        eventIdsToUpdate.push(event.id);
    });

    const { error: insertErr } = await db.from('recovery_cases').insert(caseRows);
    
    if (insertErr) {
        console.error("Error creating recovery cases:", insertErr.message);
        return;
    }

    const { error: updateErr } = await db.from('events').update({ processed: true }).in('id', eventIdsToUpdate);

    if (updateErr) {
        console.error("Error updating events as processed:", updateErr.message);
        return;
    }

    console.log(`✅ Successfully classified and created recovery cases for ${caseRows.length} events.`);
}

// If run directly, execute the classifier once
if (require.main === module) {
    processPendingEvents();
}

module.exports = { classifyEvent, processPendingEvents };
