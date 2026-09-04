require('dotenv').config();
const { createClient } = require('@supabase/supabase-js');

const supabaseUrl = process.env.SUPABASE_URL || 'http://localhost:54321';
// Use service role key on backend to bypass RLS for pipeline scripts
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || 'dummy_key';

if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
    console.warn("⚠️  SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY is missing in .env. Using dummy values.");
}

const supabase = createClient(supabaseUrl, supabaseKey);

console.log(`✅ Supabase client initialized for ${supabaseUrl}`);

module.exports = supabase;
