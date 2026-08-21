const db = require('./db');
const fs = require('fs');
const path = require('path');

const rulesPath = path.join(__dirname, '..', 'config', 'stopping_rules.json');
const stoppingRules = JSON.parse(fs.readFileSync(rulesPath, 'utf8'));

function checkDND(timezoneStr) {
    const dnd = stoppingRules.global_rules.do_not_disturb_hours;
    const now = new Date();
    // Simplified DND check using local server time for demonstration
    // In production, you would convert `now` to the specified timezone
    const currentHour = now.getHours();
    
    // If DND is from 21 to 8
    if (dnd.start > dnd.end) {
        if (currentHour >= dnd.start || currentHour < dnd.end) {
            return true;
        }
    } else {
        if (currentHour >= dnd.start && currentHour < dnd.end) {
            return true;
        }
    }
    return false;
}

function evaluatePolicy(caseData) {
    const bucket = caseData.root_cause_bucket;
    const rule = stoppingRules.buckets[bucket];

    if (!rule) {
        return { action: 'manual_review', reason: 'No rule defined for bucket' };
    }

    if (caseData.attempts >= rule.max_attempts) {
        return { action: 'stop', reason: `Max attempts (${rule.max_attempts}) reached` };
    }

    // Checking cool-off period
    const now = Math.floor(Date.now() / 1000);
    const lastUpdate = caseData.updated_at;
    const hoursSinceLastUpdate = (now - lastUpdate) / 3600;

    if (caseData.attempts > 0 && hoursSinceLastUpdate < rule.cool_off_hours) {
        return { action: 'wait', reason: `In cool-off period (${rule.cool_off_hours}h)` };
    }

    if (rule.dnd_compliance_required && checkDND(stoppingRules.global_rules.timezone)) {
        return { action: 'wait', reason: 'Do Not Disturb window active' };
    }

    return { action: rule.action, reason: 'Policy conditions met' };
}

function processPolicyEvaluations() {
    console.log("🛡️ Running Policy Engine on pending recovery cases...");

    db.all(`SELECT * FROM recovery_cases WHERE status = 'pending_policy_evaluation'`, [], (err, rows) => {
        if (err) {
            console.error("Error fetching cases:", err.message);
            return;
        }

        if (rows.length === 0) {
            console.log("No pending cases require policy evaluation.");
            return;
        }

        console.log(`Found ${rows.length} cases to evaluate.`);

        db.serialize(() => {
            db.run("BEGIN TRANSACTION");

            const updateStmt = db.prepare(`
                UPDATE recovery_cases 
                SET intervention_type = ?, status = ?, audit_trail = ?, updated_at = ?
                WHERE id = ?
            `);

            let processedCount = 0;

            rows.forEach((row) => {
                const decision = evaluatePolicy(row);
                const now = Math.floor(Date.now() / 1000);
                
                let auditTrail = [];
                try {
                    auditTrail = JSON.parse(row.audit_trail || '[]');
                } catch (e) { }

                auditTrail.push({
                    timestamp: now,
                    action: 'policy_evaluated',
                    details: `Decision: ${decision.action}. Reason: ${decision.reason}`
                });

                // Status transitions based on action
                let newStatus = 'action_determined';
                if (decision.action === 'stop' || decision.action === 'manual_review') {
                    newStatus = decision.action === 'stop' ? 'failed_to_recover' : 'requires_manual_review';
                } else if (decision.action === 'wait') {
                    newStatus = 'pending_policy_evaluation'; // Will be evaluated again later
                }

                updateStmt.run([
                    decision.action,
                    newStatus,
                    JSON.stringify(auditTrail),
                    now,
                    row.id
                ]);

                processedCount++;
            });

            updateStmt.finalize();

            db.run("COMMIT", (err) => {
                if (err) {
                    console.error("Transaction commit failed:", err.message);
                } else {
                    console.log(`✅ Successfully evaluated policy for ${processedCount} cases.`);
                }
            });
        });
    });
}

if (require.main === module) {
    processPolicyEvaluations();
    setTimeout(() => {
        db.close();
    }, 2000);
}

module.exports = { evaluatePolicy, processPolicyEvaluations };
