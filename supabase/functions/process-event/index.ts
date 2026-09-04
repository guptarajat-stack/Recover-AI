import { serve } from "https://deno.land/std@0.177.0/http/server.ts"

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

serve(async (req) => {
  // Handle CORS preflight requests
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    const payload = await req.json()
    console.log("Received payload:", JSON.stringify(payload))

    // payload comes from the Postgres trigger (pg_net) or direct webhook
    // Expected structure: { type: 'INSERT', record: { id: '...', ... } }
    const eventId = payload.record?.id

    if (!eventId) {
      throw new Error("Missing event id in payload")
    }

    // Call the internal Node backend
    // Since we are running Edge Functions in the cloud, it needs to reach the Node backend.
    // Replace with your ngrok URL or production backend URL when deploying.
    const NODE_BACKEND_URL = Deno.env.get('NODE_BACKEND_URL') || 'http://host.docker.internal:3000'

    console.log(`Forwarding event ${eventId} to ${NODE_BACKEND_URL}/internal/process-event`)

    const res = await fetch(`${NODE_BACKEND_URL}/internal/process-event`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ event_id: eventId }),
    })

    const responseText = await res.text()
    console.log("Backend response:", res.status, responseText)

    return new Response(JSON.stringify({ success: true, backend_response: responseText }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      status: 200,
    })

  } catch (error) {
    console.error("Error processing event:", error.message)
    return new Response(JSON.stringify({ error: error.message }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      status: 400,
    })
  }
})
