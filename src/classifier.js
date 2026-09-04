const db = require('./db');
const { v4: uuidv4 } = require('uuid');
const { generateEmbedding } = require('./embeddings');
const { OpenAI } = require('openai');

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

// Advanced LLM-based classifier using semantic search for context
async function classifyEvent(event) {
    const eventText = JSON.stringify({
        event_type: event.event_type,
        error_code: event.error_code,
        error_description: event.error_description,
        amount: event.amount
    });

    console.log(`Generating embedding for event ${event.id}...`);
    const embedding = await generateEmbedding(eventText);
    
    let similarCases = [];
    if (embedding) {
        // Save the embedding to the event for future searches
        await db.from('events').update({ embedding }).eq('id', event.id);

        // Find similar past cases
        const { data: matches, error: matchErr } = await db.rpc('match_cases', {
            query_embedding: embedding,
            match_threshold: 0.75,
            match_count: 3
        });

        if (matchErr) {
            console.error("Error searching similar cases:", matchErr.message);
        } else if (matches && matches.length > 0) {
            similarCases = matches;
            console.log(`Found ${matches.length} similar past cases to guide classification.`);
        }
    }

    // Prepare LLM prompt
    let promptContext = "You are a recovery classification AI. Given an event, classify its root cause into one of these buckets: 'insufficient_funds', 'bank_decline', 'expired_card', 'abandoned_checkout', 'mandate_failure', 'overdue_invoice', 'unknown'. Return a JSON object with 'bucket' (string) and 'confidence' (number 0-1).";
    
    if (similarCases.length > 0) {
        promptContext += "\n\nFor context, here are similar past events and how they were classified:\n";
        similarCases.forEach((c, idx) => {
            promptContext += `${idx + 1}. Event: ${c.event_type} | Bucket: ${c.root_cause_bucket} | Status: ${c.status}\n`;
        });
    }

    promptContext += `\n\nNow classify this new event:\n${eventText}`;

    let bucket = 'unknown';
    let confidence = 0;

    try {
        const completion = await openai.chat.completions.create({
            model: "gpt-4o-mini",
            messages: [
                { role: "system", content: promptContext }
            ],
            response_format: { type: "json_object" },
            temperature: 0.1
        });

        const result = JSON.parse(completion.choices[0].message.content);
        bucket = result.bucket || 'unknown';
        confidence = result.confidence || 0.5;
        console.log(`LLM classified event as ${bucket} (${confidence * 100}%)`);
    } catch (e) {
        console.error("LLM classification failed, falling back to rule-based:", e.message);
        // Fallback
        if (event.event_type === 'payment.failed') bucket = 'bank_decline';
        else if (event.event_type === 'subscription.halted') bucket = 'mandate_failure';
        confidence = 0.5;
    }

    return { bucket, confidence };
}

async function processPendingEvents() {
    console.log("🔍 Running Root-Cause Classifier on pending events...");
    const { data: rows, error: fetchErr } = await db.from('events').select('*').eq('processed', false);
    
    if (fetchErr || !rows || rows.length === 0) return;

    console.log(`Found ${rows.length} pending events to classify.`);
    const caseRows = [];
    const eventIdsToUpdate = [];

    for (const event of rows) {
        const classification = await classifyEvent(event);
        const caseId = uuidv4();
        const now = new Date().toISOString();
        
        const auditLog = [
            { timestamp: Math.floor(Date.now() / 1000), action: 'event_ingested', details: `Event ${event.event_type} received` },
            { timestamp: Math.floor(Date.now() / 1000), action: 'root_cause_classified', details: `Classified as ${classification.bucket} with ${Math.round(classification.confidence * 100)}% confidence` }
        ];

        caseRows.push({
            id: caseId,
            event_id: event.id,
            root_cause_bucket: classification.bucket,
            status: 'diagnosed',
            revenue_at_risk: event.amount,
            classification_confidence: classification.confidence,
            audit_trail: auditLog,
            created_at: now,
            updated_at: now
        });
        
        eventIdsToUpdate.push(event.id);
    }

    await db.from('recovery_cases').insert(caseRows);
    await db.from('events').update({ processed: true }).in('id', eventIdsToUpdate);
    console.log(`✅ Successfully classified and created recovery cases for ${caseRows.length} events.`);
}

async function processSingleEvent(eventId) {
    const { data: event, error: fetchErr } = await db.from('events').select('*').eq('id', eventId).single();
    if (fetchErr || !event || event.processed) return null;

    const classification = await classifyEvent(event);
    const caseId = uuidv4();
    const now = new Date().toISOString();
    
    const auditLog = [
        { timestamp: Math.floor(Date.now() / 1000), action: 'event_ingested', details: `Event ${event.event_type} received` },
        { timestamp: Math.floor(Date.now() / 1000), action: 'root_cause_classified', details: `Classified as ${classification.bucket} with ${Math.round(classification.confidence * 100)}% confidence` }
    ];

    await db.from('recovery_cases').insert([{
        id: caseId,
        event_id: event.id,
        root_cause_bucket: classification.bucket,
        status: 'diagnosed',
        revenue_at_risk: event.amount,
        classification_confidence: classification.confidence,
        audit_trail: auditLog,
        created_at: now,
        updated_at: now
    }]);

    await db.from('events').update({ processed: true }).eq('id', event.id);
    console.log(`✅ Successfully classified single event ${eventId} -> case ${caseId}`);
    return caseId;
}

if (require.main === module) {
    processPendingEvents();
}

module.exports = { classifyEvent, processPendingEvents, processSingleEvent };
