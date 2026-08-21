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

function processPendingEvents() {
    console.log("🔍 Running Root-Cause Classifier on pending events...");
    
    db.all(`SELECT * FROM events WHERE processed = 0`, [], (err, rows) => {
        if (err) {
            console.error("Error fetching pending events:", err.message);
            return;
        }

        if (rows.length === 0) {
            console.log("No pending events found.");
            return;
        }

        console.log(`Found ${rows.length} pending events to classify.`);

        db.serialize(() => {
            db.run("BEGIN TRANSACTION");

            let processedCount = 0;

            const insertStmt = db.prepare(`
                INSERT INTO recovery_cases (
                    id, event_id, root_cause_bucket, status, revenue_at_risk, 
                    audit_trail, created_at, updated_at
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
            `);

            const updateStmt = db.prepare(`UPDATE events SET processed = 1 WHERE id = ?`);

            rows.forEach((event) => {
                const classification = classifyEvent(event);
                const caseId = uuidv4();
                const now = Math.floor(Date.now() / 1000);
                
                const auditLog = [
                    { 
                        timestamp: now, 
                        action: 'event_ingested', 
                        details: `Event ${event.event_type} received` 
                    },
                    { 
                        timestamp: now, 
                        action: 'root_cause_classified', 
                        details: `Classified as ${classification.bucket} with ${Math.round(classification.confidence * 100)}% confidence` 
                    }
                ];

                insertStmt.run([
                    caseId, 
                    event.id, 
                    classification.bucket, 
                    'pending_policy_evaluation', 
                    event.amount,
                    JSON.stringify(auditLog),
                    now, 
                    now
                ], function(err) {
                    if (err) console.error(`Error creating recovery case for event ${event.id}:`, err.message);
                });

                updateStmt.run([event.id], function(err) {
                    if (err) console.error(`Error updating event ${event.id}:`, err.message);
                });

                processedCount++;
            });

            insertStmt.finalize();
            updateStmt.finalize();

            db.run("COMMIT", (err) => {
                if (err) {
                    console.error("Transaction commit failed:", err.message);
                } else {
                    console.log(`✅ Successfully classified and created recovery cases for ${processedCount} events.`);
                }
            });
        });
    });
}

// If run directly, execute the classifier once
if (require.main === module) {
    processPendingEvents();
    // Allow some time for queries to finish before exiting
    setTimeout(() => {
        db.close();
    }, 2000);
}

module.exports = { classifyEvent, processPendingEvents };
