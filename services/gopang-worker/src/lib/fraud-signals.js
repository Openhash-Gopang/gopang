/**
 * lib/fraud-signals.js — 신호 강도 → 위험등급 판정, 신호 영속화 공용 로직
 * (기존 webapp.html의 risk-chip S0~S3 배지 체계를 그대로 재사용)
 */

import { pbFetch } from './pb-admin.js';

export function levelFromScore(score) {
  if (score >= 80) return 'S3';
  if (score >= 60) return 'S2';
  if (score >= 30) return 'S1';
  return 'S0';
}

export function decideAction(level) {
  return { S0: 'proceed', S1: 'proceed_tagged', S2: 'require_step_up', S3: 'hold_for_review' }[level];
}

export async function persistSignals(env, l1Base, signals, { buyerGuid, sellerGuid, subjectGuids } = {}) {
  if (!l1Base || !signals?.length) return [];
  const ids = [];
  for (const s of signals) {
    const res = await pbFetch(env, l1Base, '/api/collections/fraud_signals/records', {
      method: 'POST',
      body: {
        subject_type: s.subjectType || 'tx',
        subject_id: s.subjectId || buyerGuid || '',
        signal_type: s.type,
        score: s.score,
        detail: s.detail || {},
        detected_at: new Date().toISOString(),
        detector: s.detector || 'realtime',
      },
    });
    const data = await res.json();
    if (res.ok) ids.push(data.id);
  }
  return ids;
}

export async function createFraudCase(env, l1Base, { riskLevel, signalIds = [], subjectGuids = [], detail }) {
  const res = await pbFetch(env, l1Base, '/api/collections/fraud_cases/records', {
    method: 'POST',
    body: {
      case_status: 'open',
      risk_level: riskLevel,
      signal_ids: signalIds,
      subject_guids: subjectGuids,
      detail: detail || {},
      created_at: new Date().toISOString(),
    },
  });
  return res.json();
}
