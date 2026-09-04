require('dotenv').config();
const db = require('./db');
const Razorpay = require('razorpay');
const stoppingRules = require('../config/stopping_rules.json');

const razorpay = new Razorpay({
    key_id: process.env.RAZORPAY_KEY_ID || 'dummy_key',
    key_secret: process.env.RAZORPAY_KEY_SECRET || 'dummy_secret'
});

async function executeAction(caseData) {
    const action = caseData.intervention_type;
    const amount = caseData.revenue_at_risk;
    const bucket = caseData.root_cause_bucket;
    const now = Math.floor(Date.now() / 1000);

    let result = { success: false, log: '' };

    try {
        if (action === 'send_payment_link_with_alt_method' || action === 'send_discounted_payment_link') {
            // Calculate discount if applicable
            let finalAmount = amount;
            let description = 'Payment Recovery Link';
            
            if (action === 'send_discounted_payment_link') {
                const bucketRule = stoppingRules.buckets[bucket];
                const discountPercent = (bucketRule && bucketRule.max_discount_percentage) ? bucketRule.max_discount_percentage : 10;
                finalAmount = Math.floor(amount * (1 - (discountPercent / 100)));
                description = `Special ${discountPercent}% Discount - Complete your checkout`;
            }

            // Real Razorpay API call
            const paymentLink = await razorpay.paymentLink.create({
                amount: finalAmount,
                currency: 'INR',
                accept_partial: false,
                description: description,
                reference_id: `case_${caseData.id}_${now}`, // For basic idempotency trailing
                customer: {
                    name: 'Valued Customer',
                    email: 'test_recovery@example.com',
                    contact: '+919999999999'
                },
                notify: {
                    sms: false,
                    email: false
                },
                reminder_enable: false,
                expire_by: now + (24 * 60 * 60)
            });

            result.success = true;
            result.log = `Created Payment Link: ${paymentLink.short_url} (Amount: ${finalAmount/100} INR). Sent via Sandbox.`;

        } else if (action === 'notify_and_recreate_mandate') {
            // Mandate recreation is difficult to test cleanly in Razorpay test mode without active auth tokens.
            // Keeping this simulated as per plan but logging explicitly.
            result.success = true;
            result.log = `[SIMULATED] Mandate recreation email sent to customer. (Razorpay mandate APIs require active auth tokens).`;

        } else if (action === 'promise_to_pay_tracker') {
            // Wire to real Razorpay payment link representing the invoice reminder
            const invoiceLink = await razorpay.paymentLink.create({
                amount: amount,
                currency: 'INR',
                accept_partial: true,
                description: 'Invoice Reminder - Promise to Pay Tracker',
                reference_id: `inv_case_${caseData.id}_${now}`,
                customer: {
                    name: 'B2B Client',
                    email: 'finance@example-b2b.com',
                    contact: '+918888888888'
                },
                notify: {
                    sms: false,
                    email: false
                },
                reminder_enable: true,
                expire_by: now + (7 * 24 * 60 * 60) // Expires in 7 days
            });
            result.success = true;
            result.log = `Added to Promise-to-Pay tracker. Real Invoice Reminder Link Created: ${invoiceLink.short_url}.`;
            
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

    const { data: rows, error: fetchErr } = await db.from('recovery_cases').select('*').eq('status', 'decided');
    
    if (fetchErr) {
        console.error("Error fetching cases:", fetchErr.message);
        return;
    }

    if (!rows || rows.length === 0) {
        console.log("No pending cases require execution.");
        return;
    }

    console.log(`Found ${rows.length} cases to execute.`);

    let processedCount = 0;

    for (const row of rows) {
        // Idempotency check: ensure we don't execute if already taken (guards against race conditions)
        const { data: currentCase, error: checkErr } = await db.from('recovery_cases').select('status').eq('id', row.id).single();
        const currentStatus = checkErr ? row.status : (currentCase ? currentCase.status : row.status);

        if (currentStatus === 'executed' || currentStatus === 'recovered') {
            console.log(`Skipping case ${row.id}: action already taken.`);
            continue;
        }

        console.log(`Processing case ${row.id} -> Action: ${row.intervention_type}`);
        const executionResult = await executeAction(row);
        
        const now = new Date().toISOString();
        const nowSec = Math.floor(Date.now() / 1000);
        
        let auditTrail = [];
        try {
            auditTrail = typeof row.audit_trail === 'string' ? JSON.parse(row.audit_trail) : (row.audit_trail || []);
        } catch (e) {}

        auditTrail.push({
            timestamp: nowSec,
            action: 'intervention_executed',
            details: executionResult.log
        });

        const newStatus = executionResult.success ? 'executed' : 'failed_to_recover';
        const newAttempts = row.attempts + 1;

        // Update database
        await db.from('recovery_cases').update({
            status: newStatus,
            audit_trail: auditTrail,
            updated_at: now,
            attempts: newAttempts
        }).eq('id', row.id);

        processedCount++;
    }

    console.log(`✅ Successfully executed actions for ${processedCount} cases.`);
}

if (require.main === module) {
    processExecutions();
}

module.exports = { executeAction, processExecutions };
