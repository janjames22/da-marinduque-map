-- Reference values from spec sections 4.3 and 12.
-- Barangays and boundary polygons are loaded by scripts/build-boundaries.

insert into public.programs (code, name, sort_order) values
  ('rice',      'Rice Program',                        1),
  ('corn',      'Corn Program',                        2),
  ('hvcdp',     'High Value Crop Development Program', 3),
  ('livestock', 'National Livestock Program',          4),
  ('organic',   'National Organic Agriculture Program', 5);

insert into public.municipalities (name) values
  ('Boac'), ('Buenavista'), ('Gasan'), ('Mogpog'), ('Santa Cruz'), ('Torrijos');

insert into public.categories (code, name, group_code, sort_order) values
  ('four-wheel-tractor',    'Four-Wheel Tractor',                      'land_preparation', 1),
  ('hand-tractor',          'Hand Tractor (Walking-type)',             'land_preparation', 2),
  ('rotary-tiller',         'Rotary Tiller',                           'land_preparation', 3),
  ('multi-cultivator',      'Multi-cultivator',                        'land_preparation', 4),
  ('disc-plow-harrow',      'Disc Plow / Harrow',                      'land_preparation', 5),
  ('rice-transplanter',     'Rice Transplanter (Walk-behind / Riding)', 'planting',        6),
  ('seeder',                'Seeder',                                  'planting',         7),
  ('power-sprayer',         'Power Sprayer',                           'crop_care',        8),
  ('grass-cutter',          'Grass Cutter',                            'crop_care',        9),
  ('rice-combine-harvester', 'Rice Combine Harvester',                 'harvesting',       10),
  ('rice-reaper',           'Rice Reaper',                             'harvesting',       11),
  ('rice-thresher',         'Rice Thresher',                           'postharvest',      12),
  ('multi-crop-dryer',      'Multi-crop Dryer',                        'postharvest',      13),
  ('flatbed-dryer',         'Flatbed Dryer',                           'postharvest',      14),
  ('rice-mill',             'Rice Mill',                               'postharvest',      15),
  ('corn-sheller',          'Corn Sheller',                            'postharvest',      16),
  ('corn-husker-sheller',   'Corn Husker-Sheller',                     'postharvest',      17),
  ('corn-mill',             'Corn Mill',                               'postharvest',      18),
  ('hammer-mill',           'Hammer Mill',                             'postharvest',      19),
  ('moisture-meter',        'Moisture Meter',                          'postharvest',      20),
  ('grain-collector',       'Grain Collector',                         'postharvest',      21),
  ('hermetic-bag',          'Hermetic Bag',                            'postharvest',      22),
  ('plastic-crate',         'Plastic Crate',                           'postharvest',      23),
  ('cassava-granulator',    'Cassava Granulator',                      'processing',       24),
  ('cassava-chipper',       'Cassava Chipper',                         'processing',       25),
  ('cassava-grater',        'Cassava Grater',                          'processing',       26),
  ('vacuum-sealer',         'Vacuum (Pack) Sealer',                    'processing',       27),
  ('feed-pelletizer',       'Feed Pelletizer',                         'processing',       28),
  ('forage-chopper',        'Forage/Silage Chopper',                   'processing',       29),
  ('pump-engine-set',       'Pump and Engine Set',                     'irrigation',       30),
  ('spis',                  'Solar-Powered Irrigation System (SPIS)',  'irrigation',       31),
  ('swip',                  'Small Water Impounding Project',          'irrigation',       32),
  ('diversion-dam',         'Diversion Dam',                           'irrigation',       33),
  ('other',                 'Other',                                   'other',            34);
