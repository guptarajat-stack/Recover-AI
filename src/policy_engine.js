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
    const lastUpdate = new Date(caseData.updated_at).getTime() / 1000;
    const hoursSinceLastUpdate = (now - lastUpdate) / 3600;

    if (caseData.attempts > 0 && hoursSinceLastUpdate < rule.cool_off_hours) {
        return { action: 'wait', reason: `In cool-off period (${rule.cool_off_hours}h)` };
    }

    if (rule.dnd_compliance_required && checkDND(stoppingRules.global_rules.timezone)) {
        return { action: 'wait', reason: 'Do Not Disturb window active' };
    }

    return { action: rule.action, reason: 'Policy conditions met' };
}

async function processPolicyEvaluations() {
    console.log("🛡️ Running Policy Engine on pending recovery cases...");

    const { data: rows, error: fetchErr } = await db.from('recovery_cases').select('*').eq('status', 'diagnosed');

    if (fetchErr) {
        console.error("Error fetching cases:", fetchErr.message);
        return;
    }

    if (!rows || rows.length === 0) {
        console.log("No pending cases require policy evaluation.");
        return;
    }

    console.log(`Found ${rows.length} cases to evaluate.`);

    let processedCount = 0;
    const updates = [];

    rows.forEach((row) => {
        const decision = evaluatePolicy(row);
        const now = new Date().toISOString();
        const nowSec = Math.floor(Date.now() / 1000);
        
        let auditTrail = [];
        try {
            // handle if audit_trail is parsed or string
            auditTrail = typeof row.audit_trail === 'string' ? JSON.parse(row.audit_trail) : (row.audit_trail || []);
        } catch (e) { }

        auditTrail.push({
            timestamp: nowSec,
            action: 'policy_evaluated',
            details: `Decision: ${decision.action}. Reason: ${decision.reason}`
        });

        // Status transitions based on action
        let newStatus = 'decided'; // Maps to old 'action_determined'
        if (decision.action === 'stop' || decision.action === 'manual_review') {
            newStatus = decision.action === 'stop' ? 'failed_to_recover' : 'requires_manual_review';
        } else if (decision.action === 'wait') {
            newStatus = 'diagnosed'; // Maps to old 'pending_policy_evaluation', will be evaluated again later
        }

        updates.push({
            id: row.id,
            intervention_type: decision.action,
            status: newStatus,
            audit_trail: auditTrail,
            updated_at: now
        });
    });

    // Supabase upsert/update multiple rows can be done with upsert by matching primary key.
    // Since we are just updating, upsert with all updated fields is the most efficient.
    // wait, we only want to update, not insert new ones, and we only fetched some fields? No, we fetched select('*') but only updating few fields might override missing fields to null if using upsert. 
    // It's safer to do Promise.all over individual updates.
    await Promise.all(updates.map(update => 
        db.from('recovery_cases')
          .update({
              intervention_type: update.intervention_type,
              status: update.status,
              audit_trail: update.audit_trail,
              updated_at: update.updated_at
          })
          .eq('id', update.id)
    ));

    processedCount = updates.length;
    console.log(`✅ Successfully evaluated policy for ${processedCount} cases.`);
}

async function processSinglePolicy(caseId) {
    const { data: row, error: fetchErr } = await db.from('recovery_cases').select('*').eq('id', caseId).single();

    if (fetchErr || !row) {
        console.error(`Error fetching case ${caseId}:`, fetchErr?.message || 'Not found');
        return null;
    }

    if (row.status !== 'diagnosed') {
        console.log(`Case ${caseId} is not in diagnosed state.`);
        return null;
    }

    const decision = evaluatePolicy(row);
    const now = new Date().toISOString();
    const nowSec = Math.floor(Date.now() / 1000);
    
    let auditTrail = [];
    try {
        auditTrail = typeof row.audit_trail === 'string' ? JSON.parse(row.audit_trail) : (row.audit_trail || []);
    } catch (e) { }

    auditTrail.push({
        timestamp: nowSec,
        action: 'policy_evaluated',
        details: `Decision: ${decision.action}. Reason: ${decision.reason}`
    });

    let newStatus = 'decided'; 
    if (decision.action === 'stop' || decision.action === 'manual_review') {
        newStatus = decision.action === 'stop' ? 'failed_to_recover' : 'requires_manual_review';
    } else if (decision.action === 'wait') {
        newStatus = 'diagnosed';
    }

    const updateData = {
        intervention_type: decision.action,
        status: newStatus,
        audit_trail: auditTrail,
        updated_at: now
    };

    await db.from('recovery_cases')
            .update(updateData)
            .eq('id', caseId);

    console.log(`✅ Successfully evaluated policy for single case ${caseId}`);
    return decision;
}

if (require.main === module) {
    processPolicyEvaluations();
}

module.exports = { evaluatePolicy, processPolicyEvaluations, processSinglePolicy };
