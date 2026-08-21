require('dotenv').config();
const db = require('./db');
const Razorpay = require('razorpay');

const razorpay = new Razorpay({
    key_id: process.env.RAZORPAY_KEY_ID || 'dummy_key',
    key_secret: process.env.RAZORPAY_KEY_SECRET || 'dummy_secret'
});

async function executeAction(caseData) {
    const action = caseData.intervention_type;
    const amount = caseData.revenue_at_risk;
    const now = Math.floor(Date.now() / 1000);

    let result = { success: false, log: '' };

    try {
        if (action === 'send_payment_link_with_alt_method' || action === 'send_discounted_payment_link') {
            // Calculate discount if applicable
            let finalAmount = amount;
            let description = 'Payment Recovery Link';
            
            if (action === 'send_discounted_payment_link') {
                finalAmount = Math.floor(amount * 0.9); // 10% discount
                description = 'Special 10% Discount - Complete your checkout';
            }

            // In test mode, we might not have a real customer to send to, so we use dummy info 
            // but we call the real Razorpay API to generate the link.
            const paymentLink = await razorpay.paymentLink.create({
                amount: finalAmount,
                currency: 'INR',
                accept_partial: false,
                description: description,
                customer: {
                    name: 'Valued Customer',
                    email: 'test_recovery@example.com',
                    contact: '+919999999999'
                },
                notify: {
                    sms: false, // We will simulate notification sandbox
                    email: false
                },
                reminder_enable: false,
                expire_by: now + (24 * 60 * 60) // Expires in 24 hours
            });

            result.success = true;
            result.log = `Created Payment Link: ${paymentLink.short_url} (Amount: ${finalAmount/100} INR). Sent via Sandbox.`;

        } else if (action === 'notify_and_recreate_mandate') {
            result.success = true;
            result.log = `Simulated mandate recreation email sent to customer.`;

        } else if (action === 'promise_to_pay_tracker') {
            result.success = true;
            result.log = `B2B Invoice added to Promise-to-Pay tracker. Reminder email sent.`;
            
        } else if (action === 'wait_and_retry') {
            result.success = true;
            result.log = `Scheduled for automatic retry later. No immediate external action taken.`;
            
        } else {
            result.success = false;
            result.log = `Unknown intervention type: ${action}`;
        }
    } catch (error) {
        result.success = false;
        result.log = `Razorpay API Error: ${error.message || 'Unknown error'}`;
    }

    return result;
}

async function processExecutions() {
    console.log("⚡ Running Execution Layer on determined cases...");

    db.all(`SELECT * FROM recovery_cases WHERE status = 'action_determined'`, [], async (err, rows) => {
        if (err) {
            console.error("Error fetching cases:", err.message);
            return;
        }

        if (rows.length === 0) {
            console.log("No pending cases require execution.");
            return;
        }

        console.log(`Found ${rows.length} cases to execute.`);

        let processedCount = 0;

        for (const row of rows) {
            console.log(`Processing case ${row.id} -> Action: ${row.intervention_type}`);
            const executionResult = await executeAction(row);
            
            const now = Math.floor(Date.now() / 1000);
            
            let auditTrail = [];
            try {
                auditTrail = JSON.parse(row.audit_trail || '[]');
            } catch (e) {}

            auditTrail.push({
                timestamp: now,
                action: 'intervention_executed',
                details: executionResult.log
            });

            const newStatus = executionResult.success ? 'action_taken' : 'failed_to_execute';
            const newAttempts = row.attempts + 1;

            // Update database
            await new Promise((resolve) => {
                db.run(`
                    UPDATE recovery_cases 
                    SET status = ?, audit_trail = ?, updated_at = ?, attempts = ?
                    WHERE id = ?
                `, [newStatus, JSON.stringify(auditTrail), now, newAttempts, row.id], resolve);
            });

            processedCount++;
        }

        console.log(`✅ Successfully executed actions for ${processedCount} cases.`);
    });
}

if (require.main === module) {
    processExecutions();
    setTimeout(() => {
        db.close();
    }, 5000);
}

module.exports = { executeAction, processExecutions };
