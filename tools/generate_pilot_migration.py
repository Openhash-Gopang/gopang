#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
pilot_benefit_catalog_output.json → pb_migrations/*.js 시딩 파일 생성.
기존 1786200001_seeded_kgov_resolution_tier_migration.js와 동일한 패턴
(dao.saveRecord, up/down 쌍, status='pending_review')을 그대로 따른다.
"""
import json

OUT_PATH = "pb_migrations/1786300001_seeded_benefit_catalog_pilot.js"

with open("tools/pilot_benefit_catalog_output.json", encoding="utf-8") as f:
    data = json.load(f)

def js(v) -> str:
    return json.dumps(v, ensure_ascii=False)

lines = []
lines.append('/// <reference path="../pb_data/types.d.ts" />')
lines.append('// 혜택 카탈로그(civil-petitions-raw.json, 10,966건) 파일럿 시딩 — 30건 표본')
lines.append('// (서비스분야 10종 x 3건). docs/HANDOFF-혜택카탈로그트랙_2026-07-16.md 인수인계')
lines.append('// 후 첫 파일럿. eligibility_gate 파싱은 정규식 기반 최소 추출이며, 대부분')
lines.append('// confidence:"none"으로 남아 사람 검토가 필요함을 그대로 노출한다 — 없는')
lines.append('// 정확도를 지어내지 않는다(U2 원칙). 전수(10,966건) 적재 전 스키마 검증용.')
lines.append('migrate((db) => {')
lines.append('  const dao = new Dao(db);')
lines.append('')
lines.append(f'  // ── org_profiles 시드 {len(data["orgs"])}건 ──')
lines.append('  const orgCol = dao.findCollectionByNameOrId("org_profiles");')
org_ids = []
for o in data["orgs"]:
    org_ids.append(o["org_id"])
    lines.append('  {')
    lines.append('    const rec = new Record(orgCol);')
    lines.append(f'    rec.set("org_id", {js(o["org_id"])});')
    lines.append(f'    rec.set("org_name", {js(o["org_name"])});')
    lines.append(f'    rec.set("branch", {js(o["branch"])});')
    lines.append('    rec.set("jurisdiction", "전국");')
    lines.append('    rec.set("as_of_date", "2026-07-16");')
    lines.append('    rec.set("guid_model", "government_agency");')
    lines.append('    rec.set("resolution_strategy", "complete_lookup_table");')
    lines.append(f'    rec.set("input", {js(json.dumps({"required_docs": ["본인 인증 정보"], "identity_verification": "정부24/기관별 상이(파일럿 단계 미확정)"}, ensure_ascii=False))});')
    lines.append(f'    rec.set("output", {js(json.dumps({"produces": ["복지·지원 서비스"], "format": "지원금/서비스", "dept": o.get("dept","")}, ensure_ascii=False))});')
    lines.append(f'    rec.set("automation", {js(json.dumps({"level": "manual_only", "automation_sp": None, "source_type": "manual_entry", "source_ref": "civil-petitions-raw.json 파일럿 — 미검증"}, ensure_ascii=False))});')
    lines.append('    rec.set("connected", false);')
    lines.append('    rec.set("unavailable_reason", "혜택 카탈로그 파일럿 단계 — 전수 검증 전");')
    lines.append('    rec.set("status", "pending_review");')
    lines.append('    dao.saveRecord(rec);')
    lines.append('  }')

lines.append('')
lines.append(f'  // ── atom_rows 시드 {len(data["atoms"])}건 (재사용 패턴 2개) ──')
lines.append('  const atomCol = dao.findCollectionByNameOrId("atom_rows");')
atom_ids = []
for atom_id, a in data["atoms"].items():
    atom_ids.append(atom_id)
    lines.append('  {')
    lines.append('    const rec = new Record(atomCol);')
    lines.append(f'    rec.set("atom_id", {js(atom_id)});')
    lines.append(f'    rec.set("pattern", {js(a["pattern"])});')
    lines.append(f'    rec.set("org_class", {js(a["org_class"])});')
    lines.append('    rec.set("required_docs", "[]");')
    lines.append('    rec.set("automation_sp", null);')
    lines.append('    rec.set("connected", false);')
    lines.append(f'    rec.set("unavailable_reason", {js(a["note"])});')
    lines.append('    rec.set("status", "pending_review");')
    lines.append('    rec.set("pay_subtype", "");')
    lines.append('    rec.set("regulatory_intensity", "");')
    lines.append('    rec.set("creates_new_status", false);')
    lines.append('    rec.set("outcome_type", "");')
    lines.append('    rec.set("adjudicate_subtype", "");')
    lines.append('    rec.set("escalation_to", "");')
    lines.append('    dao.saveRecord(rec);')
    lines.append('  }')

lines.append('')
lines.append(f'  // ── procedure_maps 시드 {len(data["procs"])}건 ──')
lines.append('  const procCol = dao.findCollectionByNameOrId("procedure_maps");')
goals = []
for p in data["procs"]:
    # goal은 procedure_maps에서 unique 제약 — petition_id를 괄호로 붙여 충돌 방지
    goal = f'{p["goal"]} ({p["petition_id"]})'
    goals.append(goal)
    step = {
        "seq": 1,
        "atom_id": p["atom_id"],
        "org_id": p["org_id"],
        "expert_advisor": None,
        "condition": None,
        "parallel_group": None,
    }
    lines.append('  {')
    lines.append('    const rec = new Record(procCol);')
    lines.append(f'    rec.set("goal", {js(goal)});')
    lines.append(f'    rec.set("domain", {js(p["domain"])});')
    lines.append('    rec.set("status", "pending_review");')
    lines.append(f'    rec.set("steps", {js(json.dumps([step], ensure_ascii=False))});')
    lines.append(f'    rec.set("eligibility_gate", {js(json.dumps(p["eligibility_gate"], ensure_ascii=False))});')
    lines.append('    rec.set("free_alternative", "null");')
    lines.append(f'    rec.set("as_of_date", {js(p["as_of_date"])});')
    lines.append('    rec.set("orchestrator", "AC");')
    lines.append('    dao.saveRecord(rec);')
    lines.append('  }')

lines.append('}, (db) => {')
lines.append('  const dao = new Dao(db);')
lines.append('')
lines.append('  // procedure_maps 시드 삭제')
lines.append(f'  const procGoals = {js(goals)};')
lines.append('  procGoals.forEach((g) => {')
lines.append('    try {')
lines.append('      const r = dao.findFirstRecordByData("procedure_maps", "goal", g);')
lines.append('      dao.deleteRecord(r);')
lines.append('    } catch (e) { /* 이미 없으면 무시 */ }')
lines.append('  });')
lines.append('  // atom_rows 시드 삭제')
lines.append(f'  const atomIds = {js(atom_ids)};')
lines.append('  atomIds.forEach((id) => {')
lines.append('    try {')
lines.append('      const r = dao.findFirstRecordByData("atom_rows", "atom_id", id);')
lines.append('      dao.deleteRecord(r);')
lines.append('    } catch (e) { /* 이미 없으면 무시 */ }')
lines.append('  });')
lines.append('  // org_profiles 시드 삭제')
lines.append(f'  const orgIds = {js(org_ids)};')
lines.append('  orgIds.forEach((id) => {')
lines.append('    try {')
lines.append('      const r = dao.findFirstRecordByData("org_profiles", "org_id", id);')
lines.append('      dao.deleteRecord(r);')
lines.append('    } catch (e) { /* 이미 없으면 무시 */ }')
lines.append('  });')
lines.append('})')
lines.append('')

with open(OUT_PATH, "w", encoding="utf-8") as f:
    f.write("\n".join(lines))

print(f"작성 완료: {OUT_PATH} ({len(lines)}줄)")
