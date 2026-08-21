# RecoverAI System Architecture

This document outlines the 5-stage pipeline for the RecoverAI agent.

## 5-Stage Pipeline Architecture

```mermaid
graph TD
    %% Define styles
    classDef event fill:#f9f,stroke:#333,stroke-width:2px;
    classDef module fill:#bbf,stroke:#333,stroke-width:2px;
    classDef external fill:#bfb,stroke:#333,stroke-width:2px;
    classDef data fill:#eee,stroke:#333,stroke-width:2px;

    %% Event Sources
    subgraph Event Generation
        SW[Razorpay Webhooks]:::event
        SG[Synthetic Generator]:::event
    end

    %% Pipeline Stages
    subgraph 1. Detect
        WL[Webhook Listener (Flask/FastAPI)]:::module
    end

    subgraph 2. Diagnose
        RC[Root-Cause Classifier]:::module
    end

    subgraph 3. Decide
        PE[Policy Engine]:::module
    end

    subgraph 4. Execute
        EL[Execution Layer]:::module
        MCP[Razorpay MCP Server]:::external
        NOTIFY[Notification Sandbox]:::external
    end

    subgraph 5. Measure / Audit
        DB[(Recovery Ledger DB)]:::data
        DB_AUDIT[(Audit Trail)]:::data
        DASH[Recovery Dashboard]:::module
    end

    %% Flow
    SW -->|Real Events| WL
    SG -->|Mock Events| WL
    
    WL -->|Store Raw Event| DB
    WL -->|Pass Event Context| RC
    
    RC -->|Determine Bucket (e.g. Insufficient Funds)| PE
    RC -->|Log Diagnosis| DB_AUDIT
    
    PE -->|Load Stopping Rules (JSON)| PE
    PE -->|Determine Action| EL
    PE -->|Log Decision| DB_AUDIT
    
    EL -->|API Call| MCP
    MCP <-->|Real Test-Mode Actions| RZ[Razorpay Platform]:::external
    EL -->|Send Email/WA| NOTIFY
    EL -->|Log Outcome| DB_AUDIT
    
    DB --> DASH
    DB_AUDIT --> DASH
```

### Component Details
1. **Webhook Listener**: Exposes an endpoint to receive `payment.failed`, `subscription.halted`, `order.created-without-paid`, and `invoice.overdue` events. 
2. **Root-Cause Classifier**: Analyzes event metadata (error codes, descriptions) to bucket the failure into categories like `insufficient_funds`, `bank_decline`, `expired_card`, `mandate_failure`, etc.
3. **Policy Engine**: Matches the root-cause bucket against predefined stopping rules. Determines if we should retry, send a payment link, offer a discount, or stop (if max retries reached or DND is active).
4. **Execution Layer**: Formats the desired action into an LLM call via the `razorpay-mcp-server` to perform real Razorpay test-mode API actions.
5. **Dashboard**: Reads from the local DB to visualize metrics (Revenue at Risk vs Recovered, Audit Trails).
