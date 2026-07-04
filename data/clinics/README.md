# ALS Clinics FHIR R4 Database

A curated database of ALS/MND clinics, research centers, and patient organizations worldwide, stored as FHIR R4 Bundles.

## Overview

| Metric | Count |
|--------|-------|
| Countries | 53 |
| Organizations | 1,181 |
| Total entries | 1,181 |

**Last updated:** 2026-07-04

## Directory Structure

```
clinics/
  data/           # One JSON file per country
    ar.json        # Argentina
    at.json        # Austria
    ...
    za.json        # South Africa
  README.md        # This file
```

## Data Format

Each file is a [FHIR R4 Bundle](https://www.hl7.org/fhir/R4/bundle.html) with `type: "collection"`, containing one resource type:

- **Organization** — clinics, hospitals, research labs, patient organizations

### Meta

```json
{
  "resourceType": "Bundle",
  "type": "collection",
  "meta": {
    "lastUpdated": "2026-02-14",
    "source": "manual-research",
    "country": "XX"
  },
  "entry": [...]
}
```

### ID Convention

- Organizations: `org-{country}-{NNN}` (e.g., `org-de-001`)

### Custom Coding Systems

**Facility type** (`http://help-cure-als.org/facility-type`):

| Code | Description |
|------|-------------|
| `zentrum` | Specialized ALS/MND center |
| `ambulanz` | Outpatient clinic |
| `klinik` | Hospital/clinic with neurology department |
| `rehaklinik` | Rehabilitation facility |
| `forschung` | Research institution |
| `organisation` | Patient organization / professional society |
| `pflegeeinrichtung` | Care facility |
| `centre-de-reference` | French reference center (FR only) |
| `centre-de-competence` | French competence center (FR only) |

**Specialty** (`http://help-cure-als.org/specialty`):

| Code | Description |
|------|-------------|
| `als` | ALS/MND specialization |
| `neuromuskulaer` | Neuromuscular diseases |
| `neurologie` | General neurology |

### Custom Extensions

| Extension URL | Type | Description |
|---------------|------|-------------|
| `http://help-cure-als.org/ext/notes` | `valueString` | Free-text notes (German, using ae/oe/ue) |
| `http://help-cure-als.org/ext/network` | `valueString` | Network memberships (ENCALS, TRICALS, etc.) |

## Countries

### Europe (31)

| Code | Country | Orgs | Updated | Key Centers |
|------|---------|------|---------|-------------|
| AT | Austria | 15 | 2026-02-08 | |
| BE | Belgium | 7 | 2026-02-14 | UZ Leuven, UZ Brussel-Inkendaal |
| BG | Bulgaria | 4 | 2026-02-14 | Alexandrovska Sofia |
| CH | Switzerland | 14 | 2026-02-14 | kosek-Referenzzentren |
| CZ | Czechia | 12 | 2026-02-14 | VFN Praha |
| DE | Germany | 269 | 2026-02-08 | Charite, Hannover MHH, Ulm |
| DK | Denmark | 10 | 2026-02-14 | |
| EE | Estonia | 5 | 2026-02-14 | Tartu University Hospital |
| ES | Spain | 29 | 2026-02-14 | Carlos III (Madrid), Bellvitge |
| FI | Finland | 11 | 2026-02-14 | |
| FR | France | 20 | 2026-02-14 | Pitie-Salpetriere, centres de reference |
| GB | United Kingdom | 30 | 2026-02-14 | King's, Sheffield, Oxford |
| GR | Greece | 10 | 2026-02-14 | MDA Hellas |
| HR | Croatia | 8 | 2026-02-14 | KBC Zagreb |
| HU | Hungary | 10 | 2026-02-14 | Semmelweis, Szeged |
| IE | Ireland | 12 | 2026-02-14 | Beaumont Hospital |
| IT | Italy | 19 | 2026-02-14 | San Raffaele, Molinette |
| LT | Lithuania | 3 | 2026-02-14 | LSMU Kaunas |
| LU | Luxembourg | 4 | 2026-02-14 | CHL |
| LV | Latvia | 3 | 2026-02-14 | Riga East Clinical Hospital |
| NL | Netherlands | 7 | 2026-02-14 | ALS Centrum Nederland (UMC Utrecht) |
| NO | Norway | 9 | 2026-02-14 | |
| PL | Poland | 17 | 2026-02-14 | |
| PT | Portugal | 6 | 2026-02-14 | |
| RO | Romania | 15 | 2026-02-14 | |
| RS | Serbia | 7 | 2026-02-14 | |
| SE | Sweden | 14 | 2026-02-14 | |
| SI | Slovenia | 3 | 2026-02-14 | UKC Ljubljana |
| SK | Slovakia | 5 | 2026-02-14 | Bratislava Ruzinov |
| TR | Turkey | 12 | 2026-02-14 | Istanbul University |
| UA | Ukraine | 3 | 2026-02-14 | |

### Americas (11)

| Code | Country | Orgs | Updated | Key Centers |
|------|---------|------|---------|-------------|
| US | United States | 395 | 2026-02-08 | |
| CA | Canada | 19 | 2026-02-14 | |
| BR | Brazil | 14 | 2026-02-14 | UNIFESP, ABrELA |
| AR | Argentina | 8 | 2026-02-14 | FLENI, Fundacion Esteban Bullrich |
| MX | Mexico | 7 | 2026-02-14 | TecSalud Clinica ELA |
| CO | Colombia | 6 | 2026-02-14 | HUN (ECBE-ELA), ACELA |
| CL | Chile | 5 | 2026-02-14 | Clinica Davila |
| PE | Peru | 5 | 2026-02-14 | INCN |
| CU | Cuba | 4 | 2026-02-14 | CIREN |
| UY | Uruguay | 3 | 2026-02-14 | CELAU |

### Asia-Pacific (7)

| Code | Country | Orgs | Updated | Key Centers |
|------|---------|------|---------|-------------|
| JP | Japan | 23 | 2026-02-14 | |
| AU | Australia | 18 | 2026-02-14 | Macquarie, Calvary |
| CN | China | 15 | 2026-02-14 | PUTH, CHALSR (88 hospitals) |
| KR | South Korea | 9 | 2026-02-14 | SNUH |
| IN | India | 9 | 2026-02-14 | NIMHANS, AIIMS Delhi |
| SG | Singapore | 8 | 2026-02-14 | NNI |
| TW | Taiwan | 7 | 2026-02-14 | NTUH, TVGH |

### Africa & Middle East (5)

| Code | Country | Orgs | Updated | Key Centers |
|------|---------|------|---------|-------------|
| ZA | South Africa | 8 | 2026-02-14 | Groote Schuur (UCT), Tygerberg, Chris Hani Baragwanath |
| IL | Israel | 7 | 2026-02-14 | TASMC (Ichilov), Hadassah |
| MA | Morocco | 7 | 2026-02-14 | CHU Ibn Rochd (Casablanca) |
| EG | Egypt | 6 | 2026-02-14 | Ain Shams NMU, first ALS registry in Africa |
| TN | Tunisia | 5 | 2026-02-14 | CHU Razi, ALS2/Alsin gene discovery |

## Key International Networks

| Network | Scope | Description |
|---------|-------|-------------|
| ENCALS | Europe | European Network to Cure ALS |
| TRICALS | Europe | Treatment Research Initiative to Cure ALS |
| ERN-EURO-NMD | Europe | European Reference Network for Rare Neuromuscular Diseases |
| ERN-RND | Europe | European Reference Network for Rare Neurological Diseases |
| TREAT-NMD | Europe | Translational Research in Europe for NMD |
| FILSLAN | France | Filiere de sante SLA |
| MND Association | GB/IE | Accredited Centre/Network system |
| NEALS | US-based | Northeast ALS Consortium |
| PACTALS | Asia | Pan-Asian Consortium for Treatment and Research in ALS |
| CHALSR | China | China ALS Registry (88 hospitals) |
| TROPALS | Africa | Pan-African ALS study |
| Project MinE | Global (NL) | ALS whole-genome sequencing initiative |
| International Alliance | Global | International Alliance of ALS/MND Associations |

## Language Conventions

- **Organization names**: Original language of the country
- **Notes**: German, using `ae`/`oe`/`ue` instead of umlauts

## Validation

```bash
python3 -c "
import json, os
data_dir = 'clinics/data'
for fname in sorted(os.listdir(data_dir)):
    if not fname.endswith('.json'): continue
    with open(os.path.join(data_dir, fname)) as fh:
        data = json.load(fh)
    orgs = [e for e in data['entry'] if e['resource']['resourceType'] == 'Organization']
    ids = [e['resource']['id'] for e in data['entry']]
    dupes = [i for i in ids if ids.count(i) > 1]
    cc = fname.replace('.json', '').upper()
    status = '  DUPES: ' + str(set(dupes)) if dupes else ''
    print(f'{cc}: {len(orgs)} orgs{status}')
"
```

## Data Quality

All 53 country files have been critically reviewed using parallel web-verification agents. Corrections were applied in 8 severity-ordered batches:

| Batch | Countries | Key Corrections |
|-------|-----------|-----------------|
| 1 | DK, IE, PL, FR | Fabricated practitioners, wrong classifications |
| 2 | IT, ES, PT, NO, FI, SE | Address errors, outdated names, network affiliations |
| 3 | GR, HR, SI, RS, RO, CZ, HU | Fabricated patient orgs, unverified networks |
| 4 | CH, NL, BE, GB | Wrong hospital locations, role precision |
| 5 | SK, BG, LT, LV, EE, TR, IL, UA, LU | New countries added and reviewed |
| 6 | KR, TW, CN, SG, IN | Asia-Pacific; rankings, titles, dates, gender |
| 7 | BR, AR, CL, UY, MX, CO, PE, CU | Latin America; 24 corrections + 1 new entry |
| 8 | ZA, EG, MA, TN | Africa; addresses, founding years, authorship |

### Common Error Patterns Found and Fixed

1. **Fabricated patient organizations** — fake URLs/names (RO, GR, HR, SI, CZ, HU)
2. **Unverified network claims** — ENCALS/TRICALS memberships removed where unconfirmed
3. **Outdated hospital names** — PT (ULS reform), GB (NHS trust mergers), HU (OKITI merger)
4. **Wrong physical locations** — ES (La Paz vs Carlos III), BE (CHU de Liege vs CHR Citadelle)
5. **Role title imprecision** — corrected across multiple countries
6. **Wrong specialty** — practitioners in unrelated fields removed (e.g., MS specialist in MX)

## License

This database was compiled for the [Help Cure ALS](https://help-cure-als.org) project. Data was gathered from publicly available sources including hospital websites, published research, professional directories, and patient organization registries.
