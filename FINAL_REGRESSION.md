# Final Regression

Run date: 2026-09-28. Deterministic regression and a 27-turn live DeepSeek browser QA were run against isolated demo state.

| Case | Before | Fix / expected | Actual | Pass |
|---|---|---|---|---|
| Three people | Two assignees could remain | Exactly three or explicit conflict | QA turn 15: m1, m3, m2 | Yes |
| Test-only member | Development could be assigned to Li Na | Test work only | Constraint validator checks task type; review test blocks backend assignment | Yes |
| Locked tasks | Replan could alter first tasks | Preserve complete task data | Existing locked-task regression passed | Yes |
| Three-day cap | Could replace computed duration | Keep computed two days | QA turn 14: estimated two, cap three | Yes |
| False premise | Could agree that three days fails | Correct from schedule | QA turn 17: three days feasible, estimated two | Yes |
| Five-day cap | Could claim five-day duration | Keep computed two days | QA turn 18: estimated two, cap five | Yes |
| Focus isolation | Sprint 2 limit leaked into Sprint 3 | Restore per-focus context | QA turns 19-20: Sprint 2 then US030/Sprint 3; US030 cap five, duration two | Yes |
| Workload candidate | Could answer only A/B | Name candidates and opportunity cost | QA turns 8-9 listed Wang Chen, Li Na, Chen Lin and displaced work | Yes |
| Business counts | Tasks and dependency actions mixed | Count by business operation | QA proposal: four tasks, three dependencies; after review: four tasks, two dependencies | Yes |
| Rejected action | Could appear as apply failure | Report user rejection separately | QA turn 25: six applied, one rejected, zero discrepancy | Yes |
| Hypothesis | Could change formal date | Remain meeting-only | QA turns 3-5 explicitly marked simulation; date unchanged | Yes |
| Review revalidation | Original plan reused after review | Rebuild reviewed plan | QA turn 24: four tasks, two accepted dependencies, updated path | Yes |
| Dependency rejection | Duration/path stayed stale | Recalculate DAG | Browser: four dependencies to three after rejection; duration two; QA: three to two | Yes |
| Assignee edit | Capacity stayed stale | Recalculate focused Sprint workload | Browser: Chen Lin 3h to 6h after edit and new validation | Yes |
| Actual minutes | Proposed actions shown as executed | Use applied action + history + entity | QA turn 27: four tasks, two dependencies, edited assignee and rejected dependency | Yes |

Known limitation: the schedule engine allocates member work using remaining-hour estimates and sequential per-member availability. It does not model holidays, partial-day calendars, or unrecorded time off. Capacity overage and an insufficient Sprint window are shown as warnings; confirmed hard constraints, dependency cycles, and closed Sprint block Apply.
