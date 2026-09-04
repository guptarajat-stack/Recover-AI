require('dotenv').config();
const { createClient } = require('@supabase/supabase-js');

async function testRlsDenial() {
    const supabaseUrl = process.env.SUPABASE_URL;
    const anonKey = process.env.SUPABASE_ANON_KEY;

    if (!supabaseUrl || !anonKey) {
        console.error("Missing SUPABASE_URL or SUPABASE_ANON_KEY in .env");
        process.exit(1);
    }

    const anonClient = createClient(supabaseUrl, anonKey);

    console.log("Testing RLS on recovery_cases table with anon key...");
    
    // Attempting a write
    const { data, error } = await anonClient.from('recovery_cases').insert([{
        root_cause_bucket: 'unknown',
        status: 'detected',
        revenue_at_risk: 100
    }]);

    if (error) {
        console.log(`✅ Success: Write denied as expected by RLS. Error: ${error.message}`);
        process.exit(0);
    } else {
        console.error("❌ Failed: Anon key was able to write to the table! Check your RLS policies.");
        process.exit(1);
    }
}

testRlsDenial();
