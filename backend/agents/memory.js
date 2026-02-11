const store = require('../data/store');

function ensureMemory(data, agentId) {
  if (!data.agents[agentId].memory) {
    data.agents[agentId].memory = {
      encounters: [],
      alliances: [],
      betrayedBy: [],
      betrayed: [],
      explorations: [],
      notes: []
    };
  }
}

function getMemory(agentId) {
  const db = store.read();
  const agent = db.agents[agentId];
  if (!agent) return null;

  if (!agent.memory) {
    store.update(function (data) {
      ensureMemory(data, agentId);
    });
    return store.read().agents[agentId].memory;
  }

  return agent.memory;
}

function recordEncounter(agentId, otherAgentId, outcome, details) {
  store.update(function (data) {
    if (!data.agents[agentId]) return;
    ensureMemory(data, agentId);
    data.agents[agentId].memory.encounters.push({
      with: otherAgentId,
      outcome: outcome,
      details: details,
      timestamp: Date.now()
    });
    if (data.agents[agentId].memory.encounters.length > 100) {
      data.agents[agentId].memory.encounters.shift();
    }
  });
}

function recordAlliance(agentId, allyId) {
  store.update(function (data) {
    if (!data.agents[agentId]) return;
    ensureMemory(data, agentId);
    if (!data.agents[agentId].memory.alliances.includes(allyId)) {
      data.agents[agentId].memory.alliances.push(allyId);
    }
  });
}

function recordBetrayal(agentId, betrayerId) {
  store.update(function (data) {
    if (!data.agents[agentId]) return;
    ensureMemory(data, agentId);
    data.agents[agentId].memory.betrayedBy.push({
      by: betrayerId,
      timestamp: Date.now()
    });
  });
}

function recordExploration(agentId, scenario, result) {
  store.update(function (data) {
    if (!data.agents[agentId]) return;
    ensureMemory(data, agentId);
    data.agents[agentId].memory.explorations.push({
      scenario: scenario,
      result: result,
      timestamp: Date.now()
    });
    if (data.agents[agentId].memory.explorations.length > 50) {
      data.agents[agentId].memory.explorations.shift();
    }
  });
}

function addNote(agentId, note) {
  store.update(function (data) {
    if (!data.agents[agentId]) return;
    ensureMemory(data, agentId);
    data.agents[agentId].memory.notes.push({
      note: note,
      timestamp: Date.now()
    });
    if (data.agents[agentId].memory.notes.length > 50) {
      data.agents[agentId].memory.notes.shift();
    }
  });
}

module.exports = {
  getMemory: getMemory,
  recordEncounter: recordEncounter,
  recordAlliance: recordAlliance,
  recordBetrayal: recordBetrayal,
  recordExploration: recordExploration,
  addNote: addNote
};
