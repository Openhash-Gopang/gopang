#!/usr/bin/env python3
"""
M14 Bulk Register 테스트
python test_m14_bulk_register.py
"""

import asyncio
import csv
import io
import json
import sys
import unittest
import uuid
from unittest.mock import patch, MagicMock, AsyncMock
sys.path.insert(0, '/home/claude')

from bulk_register import (
    make_guid, make_handle, hangul_to_roman,
    REGION_MAP, bulk_register, RegisterResult, process_batch,
)

class TestM14(unittest.IsolatedAsyncioTestCase):

    # BK01 유틸리티 검증
    def test_make_guid_deterministic(self):
        # 동일 번호를 다른 포맷으로 입력 시 동일 GUID
        g1 = make_guid('010-1234-5678')
        g2 = make_guid('01012345678')
        self.assertEqual(g1, g2, 'GUID는 숫자 기반 결정성')

    def test_make_guid_foreign(self):
        g1 = make_guid('+86-138-0013-0000')
        g2 = make_guid('+86 13800130000')
        self.assertEqual(g1, g2)

    def test_make_handle_hallim(self):
        h = make_handle('한림읍', '금능반점')
        self.assertTrue(h.startswith('@hallim_'), f'handle={h}')

    def test_make_handle_unknown_region(self):
        h = make_handle('미지역', '테스트')
        self.assertTrue(h.startswith('@'), f'handle={h}')

    # BK04 — 빈 전화번호 스킵
    async def test_skip_empty_phone(self):
        result = RegisterResult()
        rows = [
            {'phone': '', 'name': '김민준', 'region': '한림읍'},
            {'phone': '01012345678', 'name': '', 'region': '한림읍'},
        ]
        await process_batch(rows, 'https://mock', 'key', result, dry_run=True)
        self.assertEqual(result.skipped, 2)

    # BK01 — 100건 배치 dry-run
    async def test_batch_100_dryrun(self):
        rows = [
            {'phone': f'010{i:08d}', 'name': f'사용자{i}', 'region': '한림읍', 'entity_type': 'consumer'}
            for i in range(100)
        ]
        result = RegisterResult()
        result.total = 100
        await process_batch(rows, 'https://mock', 'key', result, dry_run=True)
        self.assertEqual(result.inserted, 100)

    # BK02 — ON CONFLICT (guid) → upsert
    async def test_guid_conflict_update(self):
        # Supabase merge-duplicates는 동일 guid → UPDATE, ok=True
        call_count = {'n': 0}
        def mock_upsert(url, key, row):
            call_count['n'] += 1
            return {'ok': True, 'status': 200}

        with patch('bulk_register.supabase_upsert', side_effect=mock_upsert):
            rows = [
                {'phone': '01099999999', 'name': '기존사용자', 'region': '한림읍'},
                {'phone': '01099999999', 'name': '기존사용자 갱신', 'region': '한림읍'},
            ]
            result = RegisterResult()
            result.total = 2
            await process_batch(rows, 'https://mock', 'key', result, dry_run=False)
        self.assertEqual(result.inserted, 2)
        self.assertEqual(call_count['n'], 2)

    # BK03 — handle 충돌 suffix
    async def test_handle_conflict_suffix(self):
        call_count = {'n': 0}
        def mock_upsert(url, key, row):
            call_count['n'] += 1
            if call_count['n'] == 1:
                return {'ok': False, 'status': 409, 'error': '23505 duplicate handle'}
            return {'ok': True, 'status': 200}

        def mock_resolve(url, key, base):
            return base + '_0001'

        with patch('bulk_register.supabase_upsert', side_effect=mock_upsert), \
             patch('bulk_register.resolve_handle', side_effect=mock_resolve):
            rows = [{'phone': '01011111111', 'name': '김민준', 'region': '한림읍'}]
            result = RegisterResult()
            result.total = 1
            await process_batch(rows, 'https://mock', 'key', result, dry_run=False)

        self.assertEqual(result.inserted, 1, f'inserted={result.inserted}, errors={result.errors}')
        self.assertEqual(call_count['n'], 2)  # 1회 실패 + 1회 재시도

    # REGION_MAP 커버리지
    def test_region_map_hallim(self):
        self.assertEqual(REGION_MAP.get('한림읍'), 'hallim')

    # hangul_to_roman
    def test_hangul_to_roman_simple(self):
        r = hangul_to_roman('가나다')
        self.assertIsInstance(r, str)
        self.assertGreater(len(r), 0)


if __name__ == '__main__':
    loader = unittest.TestLoader()
    suite  = loader.loadTestsFromTestCase(TestM14)
    runner = unittest.TextTestRunner(verbosity=2)
    result = runner.run(suite)
    sys.exit(0 if result.wasSuccessful() else 1)
