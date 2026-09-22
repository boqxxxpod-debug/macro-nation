# MACRO NATION — Codex document index

Synced: 2026-09-22

This directory is the repository-local implementation reference for Codex. The original working documents remain in the user's private Google Drive; private Drive URLs and IDs are intentionally omitted from this public repository.

| File | Role | Source revision/title | Status |
| --- | --- | --- | --- |
| `01-product-plan.md` | Product concept, target experience, MVP intent | Macro_Nation_Game_Proposal.docx / planning v1.1 | Synced |
| `02-requirements.md` | MVP requirements and acceptance criteria | Macro_Nation_MVP_Requirements.docx | Synced |
| `03-detailed-design.md` | Modules, types, processing, save/test design | Macro_Nation_MVP_Detailed_Design_v1.1 | Synced |
| `04-architecture.md` | Architecture invariants and deployment boundaries | Macro_Nation_Architecture_Design_v1.0 | Synced |
| `05-game-specification.md` | Authoritative player/game behavior | Macro_Nation_Game_Specification_v1.0 | Synced |
| `06-economic-model-parameters.md` | Economic calibration/parameter pack | Macro_Nation_Economic_Model_Parameters_v1.0 / Model v0.1.0 | Synced |
| `07-implementation-roadmap.md` | Issue sequencing and delivery gates | Macro_Nation_Implementation_Roadmap_v1.1 | Synced |
| `08-extension-architecture.md` | Repository implementation contract for adding policy inputs and indicators | Repository ADR-013 supplement | Active |

## Codex reading rule

Always start with root `AGENTS.md`, then this index, then the documents referenced by the active Issue. Do not load every document blindly when a narrower set is sufficient.

## Current status

The economic model parameter pack has been restored and synchronized. Codex may use `06-economic-model-parameters.md` as the calibration source of truth for economic coefficients, lag targets, parameter ranges, evidence classes, and golden-response tests.
