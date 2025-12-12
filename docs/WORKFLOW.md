# xcfg Workflow (Diagram)

The diagram below shows the end-to-end request lifecycle from an intent-driven frontend (e.g., ServiceNow) through translation, execution, and async completion.

```mermaid
graph LR
  SNOW[Frontend - ServiceNow] --> API[xcfg HTTP API]

  API --> ENG[Engine]
  ENG --> PLAN[Execution Plan IR]
  PLAN --> STORE[Request Store]

  PLAN --> RUN[Runner]
  RUN --> ADP[Backend Adapter]
  ADP --> VEND[Backend API]

  VEND --> CB[Callback endpoint]
  CB --> API
  RUN --> VEND

  SNOW --> API
  API --> STORE

  ENG --> AUDIT[Audit events]
  ENG --> METRICS[Metrics]
```

## DAG Execution (Plan Dependencies)

Execution Plans are **DAGs** of tasks. A task may declare dependencies via `depends_on`.

```mermaid
graph TD
  A[objects ensure] --> B[rule add]
  B --> C[policy install]
```

- A task runs only after all `depends_on` tasks are `succeeded`.
- If a task returns `running`, dependent tasks remain `queued` until polling/callback updates it to `succeeded`.
