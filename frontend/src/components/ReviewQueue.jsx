import { useEffect, useState } from 'react';
import { supabase } from '../supabase';
import { CheckCircle, XCircle, AlertCircle, Clock, DollarSign } from 'lucide-react';

export default function ReviewQueue() {
  const [cases, setCases] = useState([]);
  const [loading, setLoading] = useState(true);
  const [processingId, setProcessingId] = useState(null);

  useEffect(() => {
    fetchCases();
    
    // Subscribe to realtime changes
    const channel = supabase
      .channel('schema-db-changes')
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'recovery_cases',
        },
        (payload) => {
          console.log('Realtime update received!', payload);
          fetchCases();
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, []);

  async function fetchCases() {
    setLoading(true);
    const { data, error } = await supabase
      .from('recovery_cases')
      .select('*, events(*)')
      .eq('status', 'requires_manual_review')
      .order('created_at', { ascending: false });

    if (error) {
      console.error('Error fetching cases:', error);
    } else {
      setCases(data || []);
    }
    setLoading(false);
  }

  async function handleAction(caseId, actionType) {
    setProcessingId(caseId);
    
    // In a real app, you might just update the status to 'decided' 
    // and let the Postgres Trigger/Edge Function pick it up, or call a backend endpoint directly.
    // We update to decided, which in turn the backend executor processes.
    // But since the webhook only listens to INSERT on events, we need the backend to poll or we trigger it.
    // Actually, Phase 3 only processes on EVENT INSERT. 
    // Manual review means updating the DB. If we want immediate execution, we should ideally call the Node backend directly.
    // For this dashboard, we just update the intervention_type and status.
    const { error } = await supabase
      .from('recovery_cases')
      .update({
        intervention_type: actionType,
        status: actionType === 'manual_review_dismissed' ? 'failed_to_recover' : 'decided',
        updated_at: new Date().toISOString()
      })
      .eq('id', caseId);
      
    if (error) {
      console.error("Error updating case:", error);
    }
    
    // Remove from UI optimistically
    setCases(cases.filter(c => c.id !== caseId));
    setProcessingId(null);
  }

  if (loading && cases.length === 0) {
    return (
      <div className="flex items-center justify-center p-12">
        <div className="animate-spin rounded-full h-12 w-12 border-t-2 border-b-2 border-blue-500"></div>
      </div>
    );
  }

  if (cases.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center p-16 text-center animate-in fade-in zoom-in duration-500">
        <div className="bg-slate-800/50 p-6 rounded-full shadow-[0_0_15px_rgba(59,130,246,0.3)] mb-6 ring-1 ring-white/10">
          <CheckCircle size={64} className="text-emerald-400" />
        </div>
        <h2 className="text-2xl font-bold text-white mb-2">You're all caught up!</h2>
        <p className="text-slate-400 max-w-md">There are no cases requiring manual review in the queue right now. Great job keeping the recovery pipeline clear.</p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {cases.map((c) => (
        <div 
          key={c.id} 
          className="bg-slate-800/40 backdrop-blur-md rounded-2xl p-6 border border-slate-700/50 shadow-xl transition-all duration-300 hover:shadow-blue-900/20 hover:-translate-y-1 group"
        >
          <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
            
            <div className="flex-1 space-y-3">
              <div className="flex items-center gap-3">
                <span className="px-3 py-1 bg-red-500/10 text-red-400 text-xs font-semibold uppercase tracking-wider rounded-full border border-red-500/20 flex items-center gap-1">
                  <AlertCircle size={14} /> Review Required
                </span>
                <span className="text-slate-500 text-sm flex items-center gap-1">
                  <Clock size={14} /> {new Date(c.created_at).toLocaleString()}
                </span>
              </div>
              
              <h3 className="text-xl font-bold text-white">
                {c.root_cause_bucket.replace(/_/g, ' ').replace(/\b\w/g, l => l.toUpperCase())}
              </h3>
              
              <div className="flex items-center gap-6">
                <div className="flex items-center gap-2 text-slate-300">
                  <div className="bg-slate-700/50 p-2 rounded-lg">
                    <DollarSign size={16} className="text-emerald-400" />
                  </div>
                  <div>
                    <p className="text-xs text-slate-500 font-medium uppercase tracking-wider">Revenue at Risk</p>
                    <p className="font-semibold">{(c.revenue_at_risk / 100).toFixed(2)} INR</p>
                  </div>
                </div>
                
                <div className="flex items-center gap-2 text-slate-300">
                   <div className="bg-slate-700/50 p-2 rounded-lg">
                    <CheckCircle size={16} className="text-blue-400" />
                  </div>
                  <div>
                    <p className="text-xs text-slate-500 font-medium uppercase tracking-wider">Confidence</p>
                    <p className="font-semibold">{Math.round((c.classification_confidence || 0) * 100)}%</p>
                  </div>
                </div>
              </div>
            </div>

            <div className="flex flex-col gap-3 w-full md:w-auto">
              <button 
                onClick={() => handleAction(c.id, 'send_payment_link_with_alt_method')}
                disabled={processingId === c.id}
                className="relative overflow-hidden group bg-gradient-to-r from-blue-600 to-indigo-600 text-white font-medium px-6 py-3 rounded-xl shadow-lg transition-all hover:scale-105 active:scale-95 disabled:opacity-50 disabled:pointer-events-none"
              >
                <span className="relative z-10 flex items-center justify-center gap-2">
                  {processingId === c.id ? <div className="animate-spin h-5 w-5 border-2 border-white/30 border-t-white rounded-full" /> : <CheckCircle size={18} />}
                  Execute Alternative Link
                </span>
                <div className="absolute inset-0 h-full w-full bg-gradient-to-r from-transparent via-white/20 to-transparent -translate-x-[150%] group-hover:animate-[shimmer_1.5s_infinite]" />
              </button>
              
              <button 
                onClick={() => handleAction(c.id, 'manual_review_dismissed')}
                disabled={processingId === c.id}
                className="px-6 py-3 rounded-xl font-medium text-slate-300 border border-slate-700 bg-slate-800/50 hover:bg-red-500/10 hover:text-red-400 hover:border-red-500/30 transition-all active:scale-95 flex items-center justify-center gap-2"
              >
                <XCircle size={18} />
                Mark Unrecoverable
              </button>
            </div>

          </div>
        </div>
      ))}
    </div>
  );
}
