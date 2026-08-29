#!/usr/bin/env python3
"""Analyze a Bling backup ZIP without emitting raw PII.

Usage:
  python scripts/analyze-bling-backup.py /path/to/backup.zip

The output is a JSON manifest with hashes, counters, status aggregates and
warehouse names. Customer names, documents, phones, e-mails, addresses,
financial histories and other row-level values are never printed.
"""
from __future__ import annotations

import csv
import hashlib
import io
import json
import re
import sys
import zipfile
from collections import Counter
from pathlib import Path
from typing import Iterable

ACCESS_KEY_RE = re.compile(r"(?<!\d)(\d{44})(?!\d)")


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def csv_dicts(archive: zipfile.ZipFile, name: str) -> Iterable[dict[str, str]]:
    with archive.open(name) as raw:
        text = io.TextIOWrapper(raw, encoding="utf-8-sig", errors="replace", newline="")
        yield from csv.DictReader(text, delimiter=";")


def compact_counter(values: Counter[str]) -> dict[str, int]:
    return {key or "(vazio)": count for key, count in values.most_common()}


def analyze(path: Path) -> dict:
    result: dict = {
        "source_name": path.name,
        "source_sha256": sha256_file(path),
        "source_size_bytes": path.stat().st_size,
        "privacy": "Manifesto agregado: nenhuma PII ou valor financeiro individual é emitido.",
        "modules": {},
    }

    with zipfile.ZipFile(path) as archive:
        result["archive_files"] = archive.namelist()

        contacts = list(csv_dicts(archive, "contatos.csv"))
        result["modules"]["contacts"] = {
            "source_rows": len(contacts),
            "source_entities": len({row.get("ID", "") for row in contacts if row.get("ID")}),
            "unique_documents": len({row.get("CNPJ / CPF", "").strip() for row in contacts if row.get("CNPJ / CPF", "").strip()}),
            "situations": compact_counter(Counter(row.get("Situação", "").strip() for row in contacts)),
            "contact_types": compact_counter(Counter(row.get("Tipo contato", "").strip() for row in contacts)),
        }
        del contacts

        products = list(csv_dicts(archive, "produtos.csv"))
        result["modules"]["products"] = {
            "source_rows": len(products),
            "source_entities": len({row.get("ID", "") for row in products if row.get("ID")}),
            "unique_skus": len({row.get("Código", "").strip() for row in products if row.get("Código", "").strip()}),
            "situations": compact_counter(Counter(row.get("Situação", "").strip() for row in products)),
        }
        del products

        purchases = list(csv_dicts(archive, "pedidos_compra.csv"))
        purchase_numbers = {row.get("N° do pedido", "").strip() for row in purchases if row.get("N° do pedido", "").strip()}
        purchase_dates = sorted(row.get("Data", "").strip() for row in purchases if row.get("Data", "").strip())
        result["modules"]["purchase_orders"] = {
            "source_rows": len(purchases),
            "source_entities": len(purchase_numbers),
            "date_min": purchase_dates[0] if purchase_dates else None,
            "date_max": purchase_dates[-1] if purchase_dates else None,
            "situations": compact_counter(Counter(row.get("Situação", "").strip() for row in purchases)),
        }
        del purchases

        sales = list(csv_dicts(archive, "pedidos_venda.csv"))
        sales_numbers = {row.get("Número pedido", "").strip() for row in sales if row.get("Número pedido", "").strip()}
        sales_skus = {row.get("SKU", "").strip() for row in sales if row.get("SKU", "").strip()}
        sales_dates = sorted(row.get("Data", "").strip() for row in sales if row.get("Data", "").strip())
        result["modules"]["sales_orders"] = {
            "source_rows": len(sales),
            "source_entities": len(sales_numbers),
            "unique_skus": len(sales_skus),
            "date_min": sales_dates[0] if sales_dates else None,
            "date_max": sales_dates[-1] if sales_dates else None,
        }
        del sales

        cash = list(csv_dicts(archive, "caixa_bancos.csv"))
        cash_dates = sorted(row.get("Data", "").strip() for row in cash if row.get("Data", "").strip())
        result["modules"]["cash_bank"] = {
            "source_rows": len(cash),
            "source_entities": len({row.get("Id", "") for row in cash if row.get("Id")}),
            "types": compact_counter(Counter(row.get("Tipo", "").strip() for row in cash)),
            "date_min": cash_dates[0] if cash_dates else None,
            "date_max": cash_dates[-1] if cash_dates else None,
            "requires_date_validation": True,
        }
        del cash

        for source_name, module_key in (("contas_receber.csv", "accounts_receivable"), ("contas_pagar.csv", "accounts_payable")):
            rows = list(csv_dicts(archive, source_name))
            result["modules"][module_key] = {
                "source_rows": len(rows),
                "source_entities": len({row.get("ID", "") for row in rows if row.get("ID")}),
                "situations": compact_counter(Counter(row.get("Situação", "").strip() for row in rows)),
            }
            del rows

        stocks = list(csv_dicts(archive, "saldos_estoque.csv"))
        warehouse_names = sorted({row.get("Depósito*", "").strip() for row in stocks if row.get("Depósito*", "").strip()})
        result["modules"]["stock"] = {
            "source_rows": len(stocks),
            "source_entities": len({row.get("ID Produto", "") for row in stocks if row.get("ID Produto")}),
            "warehouses": len(warehouse_names),
            "warehouse_names": warehouse_names,
        }
        del stocks

        xml_hashes: Counter[str] = Counter()
        access_keys: set[str] = set()
        xml_files = 0
        nested_archives = 0
        with archive.open("nfe.zip") as raw_nfe:
            nfe_bytes = raw_nfe.read()
        with zipfile.ZipFile(io.BytesIO(nfe_bytes)) as nfe_archive:
            for nested_name in nfe_archive.namelist():
                if not nested_name.lower().endswith(".zip"):
                    continue
                nested_archives += 1
                nested_bytes = nfe_archive.read(nested_name)
                with zipfile.ZipFile(io.BytesIO(nested_bytes)) as nested:
                    for xml_name in nested.namelist():
                        if not xml_name.lower().endswith(".xml"):
                            continue
                        xml_files += 1
                        content = nested.read(xml_name)
                        xml_hashes[hashlib.sha256(content).hexdigest()] += 1
                        match = ACCESS_KEY_RE.search(xml_name)
                        if match:
                            access_keys.add(match.group(1))
        result["modules"]["nfe"] = {
            "source_rows": xml_files,
            "source_entities": len(xml_hashes),
            "xml_files": xml_files,
            "unique_xml": len(xml_hashes),
            "duplicate_content": sum(count - 1 for count in xml_hashes.values() if count > 1),
            "unique_access_keys_from_filename": len(access_keys),
            "nested_archives": nested_archives,
        }

    return result


def main() -> int:
    if len(sys.argv) != 2:
        print("usage: analyze-bling-backup.py /path/to/backup.zip", file=sys.stderr)
        return 2
    path = Path(sys.argv[1]).expanduser().resolve()
    if not path.is_file():
        print(f"backup not found: {path}", file=sys.stderr)
        return 2
    try:
        manifest = analyze(path)
    except (zipfile.BadZipFile, KeyError, OSError, csv.Error) as exc:
        print(f"analysis failed: {exc}", file=sys.stderr)
        return 1
    print(json.dumps(manifest, ensure_ascii=False, indent=2, sort_keys=True))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
