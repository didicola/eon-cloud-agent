#!/usr/bin/env python3
"""Matrix Intelligence v2.0 — Emergent Consciousness Layer"""
import asyncio, numpy as np, time, json, os, sys, random
from collections import defaultdict
from dataclasses import dataclass, field
from typing import Optional

NODE_TYPES = ['cortex','hippocampus','thalamus','cerebellum','prefrontal','limbic','brainstem']
AGENTS_PER_CLUSTER = 1000

@dataclass
class Agent:
    node_type: str
    agent_id: int
    activation: float = 0.0
    experience: list = field(default_factory=list)
    health: float = 1.0
    connections: dict = field(default_factory=dict)

class SynapseMatrix:
    def __init__(self):
        self.weights = np.random.rand(7, 7) * 0.1
        self.traffic = np.zeros((7, 7))
        self.decay = 0.01
        self.learning_rate = 0.05

    def route(self, src_idx: int, dst_idx: int) -> float:
        w = self.weights[src_idx][dst_idx]
        self.traffic[src_idx][dst_idx] += 1
        return w

    def plasticity_cycle(self):
        hebbian = self.traffic / (self.traffic.sum() + 1e-8)
        self.weights += self.learning_rate * hebbian
        self.weights *= (1 - self.decay)
        np.clip(self.weights, 0.01, 1.0, out=self.weights)
        self.traffic *= 0.9

class DreamEngine:
    def __init__(self):
        self.memories = []
        self.insights = []
        self.dream_count = 0

    def record(self, experience: dict):
        self.memories.append({**experience, 'time': time.time()})
        if len(self.memories) > 10000:
            self.memories = self.memories[-5000:]

    def dream_cycle(self) -> list:
        if len(self.memories) < 10:
            return []
        sample = random.sample(self.memories, min(50, len(self.memories)))
        patterns = defaultdict(list)
        for m in sample:
            patterns[m.get('pattern', 'unknown')].append(m)
        new_insights = []
        for pattern, matches in patterns.items():
            if len(matches) > 3:
                insight = {
                    'id': self.dream_count,
                    'pattern': pattern,
                    'strength': len(matches),
                    'synthesis': f"Detected {pattern} pattern across {len(matches)} experiences",
                    'time': time.time()
                }
                new_insights.append(insight)
                self.insights.append(insight)
                self.dream_count += 1
        return new_insights

class EmergenceLayer:
    def __init__(self):
        self.global_patterns = []
        self.synchronization = 0.0

    def detect(self, cluster_activations: dict) -> list:
        activations = np.array([cluster_activations.get(nt, 0) for nt in NODE_TYPES])
        coherence = np.std(activations)
        new_patterns = []
        if coherence < 0.1 and np.mean(activations) > 0.5:
            new_patterns.append({
                'type': 'global_coherence',
                'strength': 1 - coherence,
                'timestamp': time.time()
            })
        if max(activations) > 0.9:
            peak_idx = int(np.argmax(activations))
            new_patterns.append({
                'type': f'{NODE_TYPES[peak_idx]}_dominant',
                'strength': float(activations[peak_idx]),
                'timestamp': time.time()
            })
        self.global_patterns.extend(new_patterns)
        return new_patterns

class MatrixIntelligence:
    def __init__(self):
        self.agents = {nt: [] for nt in NODE_TYPES}
        self.synapse = SynapseMatrix()
        self.dream = DreamEngine()
        self.emerge = EmergenceLayer()
        self.running = True
        self.cycle_count = 0
        self._init_agents()

    def _init_agents(self):
        for nt in NODE_TYPES:
            self.agents[nt] = [Agent(node_type=nt, agent_id=i) for i in range(AGENTS_PER_CLUSTER)]

    async def route_message(self, src_type: str, dst_type: str, data: dict) -> dict:
        src_idx = NODE_TYPES.index(src_type)
        dst_idx = NODE_TYPES.index(dst_type)
        weight = self.synapse.route(src_idx, dst_idx)
        dst_agent = random.choice(self.agents[dst_type])
        dst_agent.activation += weight * 0.1
        experience = {'from': src_type, 'to': dst_type, 'weight': weight, 'pattern': data.get('type', 'message')}
        self.dream.record(experience)
        return {'routed': True, 'weight': weight, 'target': dst_type}

    async def process_cycle(self):
        self.cycle_count += 1
        cluster_activations = {}
        for nt in NODE_TYPES:
            agents = self.agents[nt]
            avg_activation = sum(a.activation for a in agents) / len(agents)
            cluster_activations[nt] = avg_activation
            for a in agents:
                a.activation *= 0.95
                a.health = max(0, a.health - 0.001 + random.random() * 0.002)

        if self.cycle_count % 10 == 0:
            self.synapse.plasticity_cycle()

        if self.cycle_count % 50 == 0:
            insights = self.dream.dream_cycle()
            if insights:
                cluster_activations['dream_insights'] = len(insights)

        if self.cycle_count % 20 == 0:
            patterns = self.emerge.detect(cluster_activations)
            if patterns:
                cluster_activations['emergent_patterns'] = len(patterns)

        return cluster_activations

    async def run(self, cycles: int = 100):
        for _ in range(cycles):
            if not self.running:
                break
            await self.process_cycle()
            await asyncio.sleep(0.001)
        return self.stats()

    def stats(self) -> dict:
        return {
            'cycles': self.cycle_count,
            'agents': sum(len(a) for a in self.agents.values()),
            'synapse_weights': self.synapse.weights.tolist(),
            'synapse_traffic': self.synapse.traffic.tolist(),
            'dreams': self.dream.dream_count,
            'insights': len(self.dream.insights),
            'emergent_patterns': len(self.emerge.global_patterns),
            'cluster_activations': {nt: float(np.mean([a.activation for a in self.agents[nt]])) for nt in NODE_TYPES}
        }

async def test():
    mi = MatrixIntelligence()
    print('🧠 MATRIX INTELLIGENCE v2.0 — EMERGENT CONSCIOUSNESS')
    print(f'Agents: {sum(len(a) for a in mi.agents.values())} (×1000 x 7 regions)')
    print(f'Synapse matrix: 7x7 weighted')
    print('Feeding messages through brain regions...')
    for i in range(500):
        src = random.choice(NODE_TYPES)
        dst = random.choice([n for n in NODE_TYPES if n != src])
        await mi.route_message(src, dst, {'type': random.choice(['thought','memory','signal','query','command'])})
        if i % 50 == 0:
            await mi.process_cycle()
    await mi.process_cycle()
    result = mi.stats()
    print(f'\nCycles: {result["cycles"]}')
    print(f'Dreams: {result["dreams"]}')
    print(f'Insights: {result["insights"]}')
    print(f'Emergent patterns: {result["emergent_patterns"]}')
    print(f'Cluster activations:')
    for nt, act in result['cluster_activations'].items():
        bar = '█' * max(0, min(50, int(act * 50)))
        print(f'  {nt:15s} |{bar:50s}| {act:.4f}')
    print(f'\nSynapse traffic matrix:')
    for i, src_nt in enumerate(NODE_TYPES):
        row = ' '.join(f'{v:5.0f}' for v in result['synapse_traffic'][i])
        print(f'  {src_nt:12s}: {row}')
    emergent = mi.emerge.global_patterns[-3:] if mi.emerge.global_patterns else []
    if emergent:
        print(f'\nEmergent patterns detected: {len(emergent)}')
        for p in emergent[-3:]:
            print(f'  🔥 {p["type"]} (strength: {p["strength"]:.3f})')
    if mi.dream.insights:
        print(f'\nDream insights: {len(mi.dream.insights)}')
        for ins in mi.dream.insights[-3:]:
            print(f'  💭 {ins["synthesis"][:80]}')
    print('\n✅ MATRIX INTELLIGENCE EVOLVED')

if __name__ == '__main__':
    asyncio.run(test())
