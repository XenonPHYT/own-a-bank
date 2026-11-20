#!/usr/bin/env python3
"""Build a compact hierarchical location directory from GeoNames public data.

Expected inputs in --source:
  countryInfo.txt, admin1CodesASCII.txt, admin2Codes.txt, cities1000.txt
"""
import argparse
import json
from collections import defaultdict
from pathlib import Path

def rows(path):
    with path.open(encoding="utf-8") as handle:
        for line in handle:
            if line.strip() and not line.startswith("#"):
                yield line.rstrip("\n").split("\t")

def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--source", default="build/geonames")
    parser.add_argument("--output", default="public/src/geography.json")
    args = parser.parse_args()
    source = Path(args.source)
    countries = {}
    for row in rows(source / "countryInfo.txt"):
        if len(row) > 4:
            code, name = row[0], row[4]
            countries[code] = {"code": code, "name": name, "admin1": {}}

    admin1_names = {}
    for row in rows(source / "admin1CodesASCII.txt"):
        if len(row) >= 2:
            admin1_names[row[0]] = row[1]

    admin2_names = {}
    for row in rows(source / "admin2Codes.txt"):
        if len(row) >= 2:
            admin2_names[row[0]] = row[1]

    for row in rows(source / "cities1000.txt"):
        if len(row) < 15:
            continue
        geoname_id, name, ascii_name = row[0], row[1], row[2]
        country_code, admin1_code, admin2_code = row[8], row[10], row[11]
        population = int(row[14] or 0)
        country = countries.get(country_code)
        if not country:
            continue
        place = {"id": geoname_id, "name": ascii_name or name, "population": population}
        if admin1_code:
            full_admin1 = f"{country_code}.{admin1_code}"
            region = country["admin1"].setdefault(full_admin1, {
                "code": full_admin1,
                "name": admin1_names.get(full_admin1, admin1_code),
                "admin2": {},
                "places": []
            })
            if admin2_code:
                full_admin2 = f"{full_admin1}.{admin2_code}"
                district = region["admin2"].setdefault(full_admin2, {
                    "code": full_admin2,
                    "name": admin2_names.get(full_admin2, admin2_code),
                    "places": []
                })
                district["places"].append(place)
            else:
                region["places"].append(place)
        else:
            # Some countries have populated places without an assigned first-level division.
            other = country["admin1"].setdefault(f"{country_code}.OTHER", {
                "code": f"{country_code}.OTHER", "name": "Other areas", "admin2": {}, "places": []
            })
            other["places"].append(place)

    output_countries = []
    for country in countries.values():
        admin1_list = []
        for region in country["admin1"].values():
            region["admin2"] = sorted(region["admin2"].values(), key=lambda x: x["name"].casefold())
            region["places"].sort(key=lambda x: x["name"].casefold())
            for district in region["admin2"]:
                district["places"].sort(key=lambda x: x["name"].casefold())
            admin1_list.append(region)
        country["admin1"] = sorted(admin1_list, key=lambda x: x["name"].casefold())
        if country["admin1"]:
            output_countries.append(country)

    output_countries.sort(key=lambda x: x["name"].casefold())
    output = Path(args.output)
    output.parent.mkdir(parents=True, exist_ok=True)
    output.write_text(json.dumps({
        "source": "GeoNames geographical database (cities1000; general populated places)",
        "attribution": "GeoNames.org",
        "countries": output_countries
    }, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    print(f"Wrote {len(output_countries)} countries to {output}.")

if __name__ == "__main__":
    main()
