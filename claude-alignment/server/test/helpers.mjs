export const answer = (over = {}) => ({
  summary: 'Students research a geoscientist.',
  requiredWork: ['A biographical paragraph', 'Two replies'],
  limits: 'No rubric was supplied.',
  alignment: [
    { objectiveId: '1.1', objectiveAction: 'describe the scientific method', requiredAction: 'Nothing in the instructions requires this.', score: 1, reason: 'Not required.', evidence: [], improvement: 'Ask students to outline the method the scientist used.' },
    { objectiveId: '1.2', objectiveAction: 'evaluate measurement methods', requiredAction: 'Optional description of measurements.', score: 2, reason: 'Optional only.', evidence: ['Describe observations, measurements, maps, or fossils if available in the source.'], improvement: 'Require a comparison of two methods.' },
  ],
  ai: { armsLevel: 5, productionEase: 'Very easy.', qualityImpact: 'Large.', reason: 'ARMS 5.', evidence: ['Write a paragraph about the person'], assumptions: 'Online, unsupervised.', suggestion: 'Add a short conversation.', resilienceSteps: ['Quote the source used.'], aiasSuggestion: { level: 2, aiMayHelp: 'Brainstorm.', studentMustDo: 'Write the paragraph.' } },
  ...over,
});

export const fakeClient = (answers, calls = []) => ({
  beta: { messages: { stream: params => { calls.push(params); const a = answers.shift(); return { finalMessage: async () => (a instanceof Error ? Promise.reject(a) : a.stop_reason ? a : { stop_reason: 'end_turn', model: 'claude-opus-5-5', usage: {}, content: [{ type: 'text', text: JSON.stringify(a) }] }) }; } } },
});
