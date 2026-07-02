// Watch every call's cost with the onSpend hook.
//
//   npm i budget-guard
//   node examples/cost-observability.mjs
//
// A hard cap *stops* runaway spend; onSpend lets you *see* it. It fires once
// per successful call with { project, feature, model, usd, dayTotalUsd } — pipe
// that into your logs, an OpenTelemetry span, or a metrics counter. Cost caps
// and execution traces are two halves of the same safety story.

import { guard } from 'budget-guard';

const fakeClient = { create: async () => ({ usage: { input: 1000, output: 1000 } }) };

const ai = guard(fakeClient, {
  project: 'demo-app',
  dailyCapUSD: 50,
  onSpend: (e) => {
    // Structured line — swap console.log for your logger / tracer / statsd.
    console.log(JSON.stringify({ evt: 'llm_spend', ...e }));
    // e.g. metrics.increment('llm.cost_usd', e.usd, { project: e.project, feature: e.feature });
    // e.g. span.setAttribute('llm.day_total_usd', e.dayTotalUsd);
  },
  onExceeded: ({ project, spentUsd, capUsd }) => {
    // Fires the moment the cap is hit — page someone, flip a flag, etc.
    console.log(JSON.stringify({ evt: 'llm_cap_hit', project, spentUsd, capUsd }));
  },
});

await ai.create({ model: 'gpt-4o' }, { feature: 'summarize' });
await ai.create({ model: 'gpt-4o-mini' }, { feature: 'classify' });
await ai.create({ model: 'gpt-4o' }, { feature: 'summarize' });

// Keep the callback light: it runs synchronously right before the response is
// returned, so push heavy work (network, disk) onto a queue rather than blocking here.
