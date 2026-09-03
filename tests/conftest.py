"""Run real endpoint bodies without importing main's production startup DDL."""
import ast
from datetime import datetime, timedelta
from decimal import Decimal
from io import BytesIO
from pathlib import Path
from urllib.parse import quote
from uuid import UUID, uuid4
from zoneinfo import ZoneInfo

import pandas as pd
import pytest
from fastapi.responses import Response
from openpyxl import Workbook
from openpyxl.styles import Alignment, Border, Font, PatternFill, Side
from openpyxl.utils import get_column_letter
from sqlalchemy import and_, case, cast, create_engine, exists, func, or_, String
from sqlalchemy.orm import Session

from app import finance, models, stock
from app.ledger_cutover import PENDING_PARTY_IDS, is_cutover_opening, project_cutover_openings

BUSINESS_TIMEZONE = ZoneInfo("Asia/Kolkata")


@pytest.fixture
def db():
    engine = create_engine("sqlite:///:memory:")
    models.Base.metadata.create_all(engine)
    with Session(engine) as session:
        yield session
    engine.dispose()


@pytest.fixture
def endpoints():
    namespace = dict(globals())
    namespace.update({key: value for key, value in vars(finance).items() if not key.startswith("_")})
    namespace.update({key: value for key, value in vars(stock).items() if not key.startswith("_")})
    parts = []
    for node in ast.parse((Path(__file__).parents[1] / "app/main.py").read_text()).body:
        if isinstance(node, ast.Assign):
            try:
                value = ast.literal_eval(node.value)
            except (ValueError, TypeError):
                continue
            for target in node.targets:
                if isinstance(target, ast.Name):
                    namespace[target.id] = value
        if isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef)):
            node.decorator_list = []
            node.args.defaults = [ast.Constant(None) if isinstance(value, ast.Call) else value for value in node.args.defaults]
            node.args.kw_defaults = [ast.Constant(None) if isinstance(value, ast.Call) else value for value in node.args.kw_defaults]
            parts.append(node)
    namespace["PROCESS_DAY_SOURCE_ITEMS"] = list(stock.SOURCE_ITEMS)
    namespace["RETAIL_SOURCE_TYPE_ALIASES"] = stock.SOURCE_ALIASES
    module = ast.Module(body=[ast.ImportFrom(module="__future__", names=[ast.alias(name="annotations")], level=0), *parts], type_ignores=[])
    exec(compile(ast.fix_missing_locations(module), "app/main.py", "exec"), namespace)
    return namespace
