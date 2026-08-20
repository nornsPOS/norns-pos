--
-- PostgreSQL database dump
--


-- Dumped from database version 17.10 (Debian 17.10-1.pgdg12+1)
-- Dumped by pg_dump version 17.10 (Debian 17.10-1.pgdg12+1)

SET statement_timeout = 0;
SET lock_timeout = 0;
SET idle_in_transaction_session_timeout = 0;
SET transaction_timeout = 0;
SET client_encoding = 'UTF8';
SET standard_conforming_strings = on;
SELECT pg_catalog.set_config('search_path', '', false);
SET check_function_bodies = false;
SET xmloption = content;
SET client_min_messages = warning;
SET row_security = off;

--
-- Data for Name: categories; Type: TABLE DATA; Schema: public; Owner: -
--

INSERT INTO public.categories VALUES
	('bb354583-dc94-4e2c-943f-464d45d98f29', NULL, 'gold', 'Gold', NULL, NULL, NULL, NULL, 10, false, '2026-06-11 23:39:54.312549+00', '2026-06-11 23:39:54.312549+00'),
	('bbf2caf3-b28c-4dbf-b44f-c5afed1cdb87', NULL, 'silber', 'Silber', NULL, NULL, NULL, NULL, 20, false, '2026-06-11 23:39:54.312549+00', '2026-06-11 23:39:54.312549+00'),
	('5f50a656-144b-466f-bdfa-c2335186e5f1', NULL, 'platin', 'Platin', NULL, NULL, NULL, NULL, 30, false, '2026-06-11 23:39:54.312549+00', '2026-06-11 23:39:54.312549+00'),
	('e2ea41da-7836-4f25-94a6-0810cf851d36', NULL, 'palladium', 'Palladium', NULL, NULL, NULL, NULL, 40, false, '2026-06-11 23:39:54.312549+00', '2026-06-11 23:39:54.312549+00'),
	('b071418b-64d7-476f-86da-4d2547c8c65d', NULL, 'muenzen', 'Münzen', NULL, NULL, NULL, NULL, 50, false, '2026-06-11 23:39:54.312549+00', '2026-06-11 23:39:54.312549+00'),
	('27721b6a-65c3-456f-a268-c9ae1310264b', NULL, 'briefmarken', 'Briefmarken', NULL, NULL, NULL, NULL, 60, false, '2026-06-11 23:39:54.312549+00', '2026-06-11 23:39:54.312549+00'),
	('bacaf227-8292-4500-b0f8-64959def08cd', NULL, 'schmuck', 'Schmuck', NULL, NULL, NULL, NULL, 70, false, '2026-06-11 23:39:54.312549+00', '2026-06-11 23:39:54.312549+00'),
	('c79344eb-e97d-43b6-a29d-d4950b9dc96f', NULL, 'barren', 'Barren', NULL, NULL, NULL, NULL, 80, false, '2026-06-11 23:39:54.312549+00', '2026-06-11 23:39:54.312549+00'),
	('46e6880f-7a95-4476-a3a8-d022c5194853', NULL, 'medaillen', 'Medaillen', NULL, NULL, NULL, NULL, 90, false, '2026-06-11 23:39:54.312549+00', '2026-06-11 23:39:54.312549+00'),
	('faf77662-f4ec-449d-a2f2-cb6041e259b0', NULL, 'banknoten', 'Banknoten', NULL, NULL, NULL, NULL, 100, false, '2026-06-11 23:39:54.312549+00', '2026-06-11 23:39:54.312549+00'),
	('9e720f9c-1ca7-437c-a9a7-52f916ed0068', NULL, 'postkarten', 'Postkarten', NULL, NULL, NULL, NULL, 110, false, '2026-06-11 23:39:54.312549+00', '2026-06-11 23:39:54.312549+00'),
	('725962a4-a6af-4393-8cc4-f5afbad3b9c1', NULL, 'militaria', 'Militaria', NULL, NULL, NULL, NULL, 120, false, '2026-06-11 23:39:54.312549+00', '2026-06-11 23:39:54.312549+00'),
	('447ec3c9-4a3b-4f94-8fb8-473d70de10f4', NULL, 'antiquitaeten', 'Antiquitäten', NULL, NULL, NULL, NULL, 130, false, '2026-06-11 23:39:54.312549+00', '2026-06-11 23:39:54.312549+00'),
	('eca71695-43b5-4276-8d23-4e987298b3d8', NULL, 'uhren', 'Uhren', NULL, NULL, NULL, NULL, 140, false, '2026-06-11 23:39:54.312549+00', '2026-06-11 23:39:54.312549+00'),
	('ac695f20-1e21-4157-89c9-b9a47ed3ed8f', NULL, 'orden-ehrenzeichen', 'Orden & Ehrenzeichen', NULL, NULL, NULL, NULL, 150, false, '2026-06-11 23:39:54.312549+00', '2026-06-11 23:39:54.312549+00'),
	('31ffc0ee-dab9-4287-995b-44f41aaf32e1', NULL, 'ansichtskarten', 'Ansichtskarten', NULL, NULL, NULL, NULL, 160, false, '2026-06-11 23:39:54.312549+00', '2026-06-11 23:39:54.312549+00'),
	('698af46b-60b2-4723-900c-5b572a4b782a', NULL, 'konvolute', 'Konvolute', NULL, NULL, NULL, NULL, 170, false, '2026-06-11 23:39:54.312549+00', '2026-06-11 23:39:54.312549+00'),
	('d4470ba8-d9ea-4892-8c65-f2bff4454db3', NULL, 'neuheiten', 'Neuheiten', NULL, NULL, NULL, NULL, 180, false, '2026-06-11 23:39:54.312549+00', '2026-06-11 23:39:54.312549+00'),
	('336e136b-8762-4cd1-bd57-672d1a1e2189', 'b071418b-64d7-476f-86da-4d2547c8c65d', 'goldmuenzen', 'Goldmünzen', NULL, NULL, NULL, NULL, 10, false, '2026-06-11 23:39:54.312549+00', '2026-06-11 23:39:54.312549+00'),
	('d6a2d3d9-b89d-4979-a406-a1f802f4190e', 'b071418b-64d7-476f-86da-4d2547c8c65d', 'silbermuenzen', 'Silbermünzen', NULL, NULL, NULL, NULL, 20, false, '2026-06-11 23:39:54.312549+00', '2026-06-11 23:39:54.312549+00'),
	('f2ec8cd2-4bdb-400f-a2c6-ae3cebe38c14', 'b071418b-64d7-476f-86da-4d2547c8c65d', 'platinmuenzen', 'Platinmünzen', NULL, NULL, NULL, NULL, 30, false, '2026-06-11 23:39:54.312549+00', '2026-06-11 23:39:54.312549+00'),
	('fb5272fa-293d-4ea6-adc6-c1f643729c4e', 'b071418b-64d7-476f-86da-4d2547c8c65d', 'palladiummuenzen', 'Palladiummünzen', NULL, NULL, NULL, NULL, 40, false, '2026-06-11 23:39:54.312549+00', '2026-06-11 23:39:54.312549+00'),
	('06ac6e34-5941-4a96-9047-f5cabdbddadd', 'b071418b-64d7-476f-86da-4d2547c8c65d', 'kaiserreich', 'Kaiserreich', NULL, NULL, NULL, NULL, 50, false, '2026-06-11 23:39:54.312549+00', '2026-06-11 23:39:54.312549+00'),
	('64d48989-4b2b-49ec-9ea1-2405d6f12a4f', 'b071418b-64d7-476f-86da-4d2547c8c65d', 'weimarer-republik', 'Weimarer Republik', NULL, NULL, NULL, NULL, 60, false, '2026-06-11 23:39:54.312549+00', '2026-06-11 23:39:54.312549+00'),
	('d772bc10-cd40-44ab-90be-4dabbd7ffc71', 'b071418b-64d7-476f-86da-4d2547c8c65d', 'deutsches-reich', 'Deutsches Reich', NULL, NULL, NULL, NULL, 70, false, '2026-06-11 23:39:54.312549+00', '2026-06-11 23:39:54.312549+00'),
	('96e6f783-45b0-4b15-9cef-dc3d95995165', 'b071418b-64d7-476f-86da-4d2547c8c65d', 'ddr', 'DDR', NULL, NULL, NULL, NULL, 80, false, '2026-06-11 23:39:54.312549+00', '2026-06-11 23:39:54.312549+00'),
	('a343c478-dd47-4523-b329-b4685ed0c0b2', 'b071418b-64d7-476f-86da-4d2547c8c65d', 'bund', 'Bund', NULL, NULL, NULL, NULL, 90, false, '2026-06-11 23:39:54.312549+00', '2026-06-11 23:39:54.312549+00'),
	('170039b1-3ecc-4794-a9f5-5a66086c7e18', 'b071418b-64d7-476f-86da-4d2547c8c65d', 'berlin', 'Berlin', NULL, NULL, NULL, NULL, 100, false, '2026-06-11 23:39:54.312549+00', '2026-06-11 23:39:54.312549+00'),
	('40a52069-3799-48f7-9d0e-0fcee7451862', 'b071418b-64d7-476f-86da-4d2547c8c65d', 'euro', 'Euro', NULL, NULL, NULL, NULL, 110, false, '2026-06-11 23:39:54.312549+00', '2026-06-11 23:39:54.312549+00'),
	('48b398f5-f675-49f9-a2a4-76f8506148a4', 'b071418b-64d7-476f-86da-4d2547c8c65d', 'ausland', 'Ausland', NULL, NULL, NULL, NULL, 120, false, '2026-06-11 23:39:54.312549+00', '2026-06-11 23:39:54.312549+00'),
	('ec1b5ee7-afea-42ce-9cfa-f2b8ff38065c', 'b071418b-64d7-476f-86da-4d2547c8c65d', 'antike-muenzen', 'Antike Münzen', NULL, NULL, NULL, NULL, 130, false, '2026-06-11 23:39:54.312549+00', '2026-06-11 23:39:54.312549+00'),
	('a94a786d-60b9-4f38-91b4-ec967ade5a3b', 'b071418b-64d7-476f-86da-4d2547c8c65d', 'notmuenzen', 'Notmünzen', NULL, NULL, NULL, NULL, 140, false, '2026-06-11 23:39:54.312549+00', '2026-06-11 23:39:54.312549+00'),
	('7483bd99-a020-4a7e-a4af-8158f869dc31', 'b071418b-64d7-476f-86da-4d2547c8c65d', 'muenzen-medaillen', 'Medaillen', NULL, NULL, NULL, NULL, 150, false, '2026-06-11 23:39:54.312549+00', '2026-06-11 23:39:54.312549+00'),
	('c3ac5f8e-2f29-4e85-bf58-11310c24a326', 'b071418b-64d7-476f-86da-4d2547c8c65d', 'muenzen-konvolute', 'Konvolute', NULL, NULL, NULL, NULL, 160, false, '2026-06-11 23:39:54.312549+00', '2026-06-11 23:39:54.312549+00'),
	('4c79b6f7-be1e-434d-909d-9ebaa8d99a1e', 'bacaf227-8292-4500-b0f8-64959def08cd', 'goldschmuck', 'Goldschmuck', NULL, NULL, NULL, NULL, 10, false, '2026-06-11 23:39:54.312549+00', '2026-06-11 23:39:54.312549+00'),
	('3d7a974c-b2c5-456f-9c7d-f73a2d8bf158', 'bacaf227-8292-4500-b0f8-64959def08cd', 'silberschmuck', 'Silberschmuck', NULL, NULL, NULL, NULL, 20, false, '2026-06-11 23:39:54.312549+00', '2026-06-11 23:39:54.312549+00'),
	('42d2aa48-e75d-4a03-94ed-8a87542a1b23', 'bacaf227-8292-4500-b0f8-64959def08cd', 'platinschmuck', 'Platinschmuck', NULL, NULL, NULL, NULL, 30, false, '2026-06-11 23:39:54.312549+00', '2026-06-11 23:39:54.312549+00'),
	('b1ccd8e8-de99-4a90-862f-bce445138c7b', 'bacaf227-8292-4500-b0f8-64959def08cd', 'vintage-schmuck', 'Vintage Schmuck', NULL, NULL, NULL, NULL, 40, false, '2026-06-11 23:39:54.312549+00', '2026-06-11 23:39:54.312549+00'),
	('00fc5960-7260-45bf-b368-3c080cab1fe8', 'bacaf227-8292-4500-b0f8-64959def08cd', 'antiker-schmuck', 'Antiker Schmuck', NULL, NULL, NULL, NULL, 50, false, '2026-06-11 23:39:54.312549+00', '2026-06-11 23:39:54.312549+00'),
	('b18bfde7-0df7-4a28-91c8-b0f34dd7ac7c', 'bacaf227-8292-4500-b0f8-64959def08cd', 'designerschmuck', 'Designerschmuck', NULL, NULL, NULL, NULL, 60, false, '2026-06-11 23:39:54.312549+00', '2026-06-11 23:39:54.312549+00'),
	('adffbe1d-095a-425d-849c-3ba88b450ea5', 'bacaf227-8292-4500-b0f8-64959def08cd', 'ringe', 'Ringe', NULL, NULL, NULL, NULL, 70, false, '2026-06-11 23:39:54.312549+00', '2026-06-11 23:39:54.312549+00'),
	('1d887b34-bae3-459c-ad05-d52ef3abe58d', 'bacaf227-8292-4500-b0f8-64959def08cd', 'ketten', 'Ketten', NULL, NULL, NULL, NULL, 80, false, '2026-06-11 23:39:54.312549+00', '2026-06-11 23:39:54.312549+00'),
	('358f8096-af66-47cb-8379-4e1679b34860', 'bacaf227-8292-4500-b0f8-64959def08cd', 'armbaender', 'Armbänder', NULL, NULL, NULL, NULL, 90, false, '2026-06-11 23:39:54.312549+00', '2026-06-11 23:39:54.312549+00'),
	('336e192b-a762-4eb7-983d-0a5f9913d6d0', 'bacaf227-8292-4500-b0f8-64959def08cd', 'ohrringe', 'Ohrringe', NULL, NULL, NULL, NULL, 100, false, '2026-06-11 23:39:54.312549+00', '2026-06-11 23:39:54.312549+00'),
	('151d15df-d9b3-48f5-b4d1-77ea27c8bc34', 'bacaf227-8292-4500-b0f8-64959def08cd', 'broschen', 'Broschen', NULL, NULL, NULL, NULL, 110, false, '2026-06-11 23:39:54.312549+00', '2026-06-11 23:39:54.312549+00'),
	('7206163a-8cd4-4776-8302-3e6f01037295', 'bacaf227-8292-4500-b0f8-64959def08cd', 'anhaenger', 'Anhänger', NULL, NULL, NULL, NULL, 120, false, '2026-06-11 23:39:54.312549+00', '2026-06-11 23:39:54.312549+00'),
	('24a840ea-d16c-4e52-a33e-0cc04ebb7058', 'bacaf227-8292-4500-b0f8-64959def08cd', 'edelsteinschmuck', 'Edelsteinschmuck', NULL, NULL, NULL, NULL, 130, false, '2026-06-11 23:39:54.312549+00', '2026-06-11 23:39:54.312549+00'),
	('a121a996-31fd-4349-93f8-d03135d030be', 'bacaf227-8292-4500-b0f8-64959def08cd', 'bernsteinschmuck', 'Bernsteinschmuck', NULL, NULL, NULL, NULL, 140, false, '2026-06-11 23:39:54.312549+00', '2026-06-11 23:39:54.312549+00'),
	('b76139d2-ffad-475d-96a1-ee2399b96100', 'bacaf227-8292-4500-b0f8-64959def08cd', 'schmuckkonvolute', 'Schmuckkonvolute', NULL, NULL, NULL, NULL, 150, false, '2026-06-11 23:39:54.312549+00', '2026-06-11 23:39:54.312549+00'),
	('ed8b8367-2cf2-422a-8175-8494b92690ec', 'c79344eb-e97d-43b6-a29d-d4950b9dc96f', 'goldbarren', 'Goldbarren', NULL, NULL, NULL, NULL, 10, false, '2026-06-11 23:39:54.312549+00', '2026-06-11 23:39:54.312549+00'),
	('62f57359-323a-4c26-adba-c9375b5d72be', 'c79344eb-e97d-43b6-a29d-d4950b9dc96f', 'silberbarren', 'Silberbarren', NULL, NULL, NULL, NULL, 20, false, '2026-06-11 23:39:54.312549+00', '2026-06-11 23:39:54.312549+00'),
	('c903a500-fb0e-4a13-8dbe-2a30d3827e4f', 'c79344eb-e97d-43b6-a29d-d4950b9dc96f', 'platinbarren', 'Platinbarren', NULL, NULL, NULL, NULL, 30, false, '2026-06-11 23:39:54.312549+00', '2026-06-11 23:39:54.312549+00'),
	('05aff576-6421-4b5c-aa10-62cd38e83475', 'c79344eb-e97d-43b6-a29d-d4950b9dc96f', 'palladiumbarren', 'Palladiumbarren', NULL, NULL, NULL, NULL, 40, false, '2026-06-11 23:39:54.312549+00', '2026-06-11 23:39:54.312549+00'),
	('671ec701-1fb9-48ce-8fe5-b1b5f7879601', 'c79344eb-e97d-43b6-a29d-d4950b9dc96f', 'geiger', 'Geiger', NULL, NULL, NULL, NULL, 50, false, '2026-06-11 23:39:54.312549+00', '2026-06-11 23:39:54.312549+00'),
	('8d5c70e2-d7a4-41c6-9d01-2f11e7cc30bc', 'c79344eb-e97d-43b6-a29d-d4950b9dc96f', 'heraeus', 'Heraeus', NULL, NULL, NULL, NULL, 60, false, '2026-06-11 23:39:54.312549+00', '2026-06-11 23:39:54.312549+00'),
	('655fc933-4100-41a2-a4d1-01bc81877c79', 'c79344eb-e97d-43b6-a29d-d4950b9dc96f', 'degussa', 'Degussa', NULL, NULL, NULL, NULL, 70, false, '2026-06-11 23:39:54.312549+00', '2026-06-11 23:39:54.312549+00'),
	('ff283d04-95e5-4303-bd86-35bacd5e06da', 'c79344eb-e97d-43b6-a29d-d4950b9dc96f', 'umicore', 'Umicore', NULL, NULL, NULL, NULL, 80, false, '2026-06-11 23:39:54.312549+00', '2026-06-11 23:39:54.312549+00'),
	('259c5e79-ddb8-461e-8b40-e8e4e6410b79', 'c79344eb-e97d-43b6-a29d-d4950b9dc96f', 'argor-heraeus', 'Argor Heraeus', NULL, NULL, NULL, NULL, 90, false, '2026-06-11 23:39:54.312549+00', '2026-06-11 23:39:54.312549+00'),
	('6753859b-8287-4bb5-ad82-1c1cdc2f0e82', 'c79344eb-e97d-43b6-a29d-d4950b9dc96f', 'diverse-hersteller', 'Diverse Hersteller', NULL, NULL, NULL, NULL, 100, false, '2026-06-11 23:39:54.312549+00', '2026-06-11 23:39:54.312549+00'),
	('bc95b04f-9d39-4853-9377-0576d2eefc95', '27721b6a-65c3-456f-a268-c9ae1310264b', 'briefmarken-deutsches-reich', 'Deutsches Reich', NULL, 'MiNr. 1–910 · Block 1–11', NULL, NULL, 10, false, '2026-06-11 23:39:54.312549+00', '2026-06-11 23:39:54.312549+00'),
	('54eac994-3741-4a56-9863-72abe515c9b2', '27721b6a-65c3-456f-a268-c9ae1310264b', 'briefmarken-berlin', 'Berlin (West)', NULL, 'MiNr. 1–879 · Block 1–8', NULL, NULL, 20, false, '2026-06-11 23:39:54.312549+00', '2026-06-11 23:39:54.312549+00'),
	('6feddc55-0e84-4bd9-98f7-17aaa4b96eea', '27721b6a-65c3-456f-a268-c9ae1310264b', 'briefmarken-bund', 'Bund', NULL, 'MiNr. 111–laufend · Block 2–laufend', NULL, NULL, 30, false, '2026-06-11 23:39:54.312549+00', '2026-06-11 23:39:54.312549+00'),
	('00986e42-6af1-4b8c-864d-ab11bda7629f', '27721b6a-65c3-456f-a268-c9ae1310264b', 'briefmarken-ddr', 'DDR', NULL, 'MiNr. 242–3365 · Block 7–100', NULL, NULL, 40, false, '2026-06-11 23:39:54.312549+00', '2026-06-11 23:39:54.312549+00'),
	('66d4e1c3-2148-4556-bfcd-4bc4c6a6da0e', '27721b6a-65c3-456f-a268-c9ae1310264b', 'altdeutschland', 'Altdeutschland', NULL, NULL, NULL, NULL, 50, false, '2026-06-11 23:39:54.312549+00', '2026-06-11 23:39:54.312549+00'),
	('752e1a5a-848d-4837-960c-705c19993885', '66d4e1c3-2148-4556-bfcd-4bc4c6a6da0e', 'baden', 'Baden', NULL, 'MiNr. 1–25', NULL, NULL, 10, false, '2026-06-11 23:39:54.312549+00', '2026-06-11 23:39:54.312549+00'),
	('1bb1bf8e-e966-4af7-a6ea-5a1f0cfa2e0b', '66d4e1c3-2148-4556-bfcd-4bc4c6a6da0e', 'bayern', 'Bayern', NULL, 'MiNr. 1–191', NULL, NULL, 20, false, '2026-06-11 23:39:54.312549+00', '2026-06-11 23:39:54.312549+00'),
	('6076c59d-1ae6-45fa-a2e5-22f28d6cf294', '66d4e1c3-2148-4556-bfcd-4bc4c6a6da0e', 'bergedorf', 'Bergedorf', NULL, 'MiNr. 1–5', NULL, NULL, 30, false, '2026-06-11 23:39:54.312549+00', '2026-06-11 23:39:54.312549+00'),
	('2a42eb07-ddf0-460d-b5e7-9379dd6b510d', '66d4e1c3-2148-4556-bfcd-4bc4c6a6da0e', 'braunschweig', 'Braunschweig', NULL, 'MiNr. 1–20', NULL, NULL, 40, false, '2026-06-11 23:39:54.312549+00', '2026-06-11 23:39:54.312549+00'),
	('5ded7f44-f7d8-4404-a73c-91cf0eb858b0', '66d4e1c3-2148-4556-bfcd-4bc4c6a6da0e', 'bremen', 'Bremen', NULL, 'MiNr. 1–19', NULL, NULL, 50, false, '2026-06-11 23:39:54.312549+00', '2026-06-11 23:39:54.312549+00'),
	('afeddf55-5985-4b86-a7ba-e34d22c4c428', '66d4e1c3-2148-4556-bfcd-4bc4c6a6da0e', 'hamburg', 'Hamburg', NULL, 'MiNr. 1–20', NULL, NULL, 60, false, '2026-06-11 23:39:54.312549+00', '2026-06-11 23:39:54.312549+00'),
	('477f5857-e730-4dd7-8027-33514dfb199f', '66d4e1c3-2148-4556-bfcd-4bc4c6a6da0e', 'hannover', 'Hannover', NULL, 'MiNr. 1–25', NULL, NULL, 70, false, '2026-06-11 23:39:54.312549+00', '2026-06-11 23:39:54.312549+00'),
	('0d98c2e5-220b-4270-b3f2-7fe48b205e4a', '66d4e1c3-2148-4556-bfcd-4bc4c6a6da0e', 'helgoland', 'Helgoland', NULL, 'MiNr. 1–20', NULL, NULL, 80, false, '2026-06-11 23:39:54.312549+00', '2026-06-11 23:39:54.312549+00'),
	('6118d58e-f6d0-47b0-8e63-ef689e6ceb56', '66d4e1c3-2148-4556-bfcd-4bc4c6a6da0e', 'luebeck', 'Lübeck', NULL, 'MiNr. 1–20', NULL, NULL, 90, false, '2026-06-11 23:39:54.312549+00', '2026-06-11 23:39:54.312549+00'),
	('97657cd5-d544-41a3-9e6b-d4b05a7baed1', '66d4e1c3-2148-4556-bfcd-4bc4c6a6da0e', 'mecklenburg-schwerin', 'Mecklenburg-Schwerin', NULL, 'MiNr. 1–25', NULL, NULL, 100, false, '2026-06-11 23:39:54.312549+00', '2026-06-11 23:39:54.312549+00'),
	('a16da911-71d0-4b2d-8479-74fe18112596', '66d4e1c3-2148-4556-bfcd-4bc4c6a6da0e', 'mecklenburg-strelitz', 'Mecklenburg-Strelitz', NULL, 'MiNr. 1–6', NULL, NULL, 110, false, '2026-06-11 23:39:54.312549+00', '2026-06-11 23:39:54.312549+00'),
	('45fb3370-a20d-4af0-96f8-266fdd0b77f0', '66d4e1c3-2148-4556-bfcd-4bc4c6a6da0e', 'oldenburg', 'Oldenburg', NULL, 'MiNr. 1–19', NULL, NULL, 120, false, '2026-06-11 23:39:54.312549+00', '2026-06-11 23:39:54.312549+00'),
	('61e5f85f-73e4-4436-a2ed-aefe646e99b6', '66d4e1c3-2148-4556-bfcd-4bc4c6a6da0e', 'preussen', 'Preußen', NULL, 'MiNr. 1–32', NULL, NULL, 130, false, '2026-06-11 23:39:54.312549+00', '2026-06-11 23:39:54.312549+00'),
	('e9705aba-9a50-4578-bce4-9db20364f0b7', '66d4e1c3-2148-4556-bfcd-4bc4c6a6da0e', 'sachsen', 'Sachsen', NULL, 'MiNr. 1–21', NULL, NULL, 140, false, '2026-06-11 23:39:54.312549+00', '2026-06-11 23:39:54.312549+00'),
	('d575ddf9-4e74-4735-a976-fe688883a2c4', '66d4e1c3-2148-4556-bfcd-4bc4c6a6da0e', 'schleswig-holstein', 'Schleswig-Holstein', NULL, 'MiNr. 1–15', NULL, NULL, 150, false, '2026-06-11 23:39:54.312549+00', '2026-06-11 23:39:54.312549+00'),
	('45923ad6-58c6-425a-a1f8-dd987bcfbc71', '66d4e1c3-2148-4556-bfcd-4bc4c6a6da0e', 'thurn-und-taxis', 'Thurn und Taxis', NULL, 'MiNr. 1–54', NULL, NULL, 160, false, '2026-06-11 23:39:54.312549+00', '2026-06-11 23:39:54.312549+00'),
	('c98f03f2-e970-4436-a4a5-9ea7cc867d6e', '66d4e1c3-2148-4556-bfcd-4bc4c6a6da0e', 'wuerttemberg', 'Württemberg', NULL, 'MiNr. 1–52', NULL, NULL, 170, false, '2026-06-11 23:39:54.312549+00', '2026-06-11 23:39:54.312549+00'),
	('ac3e7a09-3be3-4673-bdba-7d2ecaa0a275', '66d4e1c3-2148-4556-bfcd-4bc4c6a6da0e', 'norddeutscher-postbezirk', 'Norddeutscher Postbezirk', NULL, 'MiNr. 1–26', NULL, NULL, 180, false, '2026-06-11 23:39:54.312549+00', '2026-06-11 23:39:54.312549+00'),
	('9ef10a1d-13de-4fa7-bd3b-c9cd8d0bf5f8', NULL, 'ankauf', 'Ankauf', NULL, NULL, NULL, NULL, 190, true, '2026-06-11 23:39:54.312549+00', '2026-06-12 00:29:41.806563+00');


--
-- Data for Name: hallmarks; Type: TABLE DATA; Schema: public; Owner: -
--

INSERT INTO public.hallmarks VALUES
	('9031157b-2f6a-4271-b69a-ddbd7353c7b4', '333', 'gold', 333, 0.3330, 'Gold 333‰ (8 Karat)', 'Gold 333‰ (8 karat)', true, '2026-06-03 14:14:01.673804+00', '2026-06-03 14:14:01.673804+00'),
	('5a3d00ab-1171-4210-8936-6797239784f4', '585', 'gold', 585, 0.5850, 'Gold 585‰ (14 Karat)', 'Gold 585‰ (14 karat)', true, '2026-06-03 14:14:01.673804+00', '2026-06-03 14:14:01.673804+00'),
	('c2d40f19-6281-4af5-9be8-d036189ef58e', '750', 'gold', 750, 0.7500, 'Gold 750‰ (18 Karat)', 'Gold 750‰ (18 karat)', true, '2026-06-03 14:14:01.673804+00', '2026-06-03 14:14:01.673804+00'),
	('390810d7-f3cb-45bb-b0dd-64c43e57846c', '916', 'gold', 916, 0.9160, 'Gold 916‰ (22 Karat)', 'Gold 916‰ (22 karat)', true, '2026-06-03 14:14:01.673804+00', '2026-06-03 14:14:01.673804+00'),
	('62cd6ad0-11db-4c96-bd37-4cc461b261bc', '999', 'gold', 999, 0.9990, 'Gold 999‰ (Feingold)', 'Gold 999‰ (fine gold)', true, '2026-06-03 14:14:01.673804+00', '2026-06-03 14:14:01.673804+00'),
	('eec75a56-3fb1-4e8a-a723-77f401597c46', '800', 'silver', 800, 0.8000, 'Silber 800‰', 'Silver 800‰', true, '2026-06-03 14:14:01.673804+00', '2026-06-03 14:14:01.673804+00'),
	('1bcb57bf-5098-4aba-b499-c71b1911b37e', '835', 'silver', 835, 0.8350, 'Silber 835‰', 'Silver 835‰', true, '2026-06-03 14:14:01.673804+00', '2026-06-03 14:14:01.673804+00'),
	('803d5db9-73f0-4018-ba9a-00d7857117ef', '925', 'silver', 925, 0.9250, 'Silber 925‰ (Sterling)', 'Silver 925‰ (sterling)', true, '2026-06-03 14:14:01.673804+00', '2026-06-03 14:14:01.673804+00'),
	('1d37796d-8209-4d7e-8b8b-4b62aefbb252', '950', 'silver', 950, 0.9500, 'Silber 950‰', 'Silver 950‰', true, '2026-06-03 14:14:01.673804+00', '2026-06-03 14:14:01.673804+00'),
	('b187761e-e31c-472f-bbc7-9b15623bba71', '999', 'silver', 999, 0.9990, 'Silber 999‰ (Feinsilber)', 'Silver 999‰ (fine silver)', true, '2026-06-03 14:14:01.673804+00', '2026-06-03 14:14:01.673804+00'),
	('3bc0d36c-34fc-4a5e-97bd-abacf4d274d8', '850', 'platinum', 850, 0.8500, 'Platin 850‰', 'Platinum 850‰', true, '2026-06-03 14:14:01.673804+00', '2026-06-03 14:14:01.673804+00'),
	('e9b21895-0b37-4d3b-9358-dd0201c92ebc', '900', 'platinum', 900, 0.9000, 'Platin 900‰', 'Platinum 900‰', true, '2026-06-03 14:14:01.673804+00', '2026-06-03 14:14:01.673804+00'),
	('dd8e769b-74a9-4bf2-af6d-b3ffbeeb34d3', '950', 'platinum', 950, 0.9500, 'Platin 950‰', 'Platinum 950‰', true, '2026-06-03 14:14:01.673804+00', '2026-06-03 14:14:01.673804+00'),
	('0d2c7655-0548-49ef-9200-98a4394beeef', '999', 'platinum', 999, 0.9990, 'Platin 999‰ (Feinplatin)', 'Platinum 999‰ (fine platinum)', true, '2026-06-03 14:14:01.673804+00', '2026-06-03 14:14:01.673804+00'),
	('dcd6446a-9a92-4f99-8ebb-996969964c83', '500', 'palladium', 500, 0.5000, 'Palladium 500‰', 'Palladium 500‰', true, '2026-06-03 14:14:01.673804+00', '2026-06-03 14:14:01.673804+00'),
	('2ac1ade5-53af-40f5-a231-438e67c213c1', '950', 'palladium', 950, 0.9500, 'Palladium 950‰', 'Palladium 950‰', true, '2026-06-03 14:14:01.673804+00', '2026-06-03 14:14:01.673804+00'),
	('f1847c88-165e-4a27-81a9-0a4a62bfcabd', '999', 'palladium', 999, 0.9990, 'Palladium 999‰ (Feinpalladium)', 'Palladium 999‰ (fine palladium)', true, '2026-06-03 14:14:01.673804+00', '2026-06-03 14:14:01.673804+00');


--
-- Data for Name: karat_grades; Type: TABLE DATA; Schema: public; Owner: -
--

INSERT INTO public.karat_grades VALUES
	('8K', 8, 333, 0.3330, '333', 'Gold 333‰ (8 Karat)', true, '2026-06-03 14:14:01.673804+00', '2026-06-03 14:14:01.673804+00'),
	('14K', 14, 585, 0.5850, '585', 'Gold 585‰ (14 Karat)', true, '2026-06-03 14:14:01.673804+00', '2026-06-03 14:14:01.673804+00'),
	('18K', 18, 750, 0.7500, '750', 'Gold 750‰ (18 Karat)', true, '2026-06-03 14:14:01.673804+00', '2026-06-03 14:14:01.673804+00'),
	('22K', 22, 916, 0.9160, '916', 'Gold 916‰ (22 Karat)', true, '2026-06-03 14:14:01.673804+00', '2026-06-03 14:14:01.673804+00'),
	('24K', 24, 999, 0.9990, '999', 'Gold 999‰ (Feingold)', true, '2026-06-03 14:14:01.673804+00', '2026-06-03 14:14:01.673804+00');


--
-- Data for Name: payment_commission_rates; Type: TABLE DATA; Schema: public; Owner: -
--



--
-- Data for Name: shipping_zones; Type: TABLE DATA; Schema: public; Owner: -
--

INSERT INTO public.shipping_zones VALUES
	('772855e4-d407-49f3-b585-8faeffe0a9d6', 'DE', 'Deutschland', '{DE}', false, 10, true, '2026-07-22 19:39:04.472802+00', '2026-07-22 19:39:04.472802+00'),
	('9b4f5c84-0f4b-4654-9a6f-30b96b97c60c', 'EU', 'Europäische Union', '{AT,BE,BG,HR,CY,CZ,DK,EE,FI,FR,GR,HU,IE,IT,LV,LT,LU,MT,NL,PL,PT,RO,SK,SI,ES,SE}', false, 20, true, '2026-07-22 19:39:04.472802+00', '2026-07-22 19:39:04.472802+00'),
	('22a313c8-88e4-44c8-bcbd-b6193f786a11', 'WORLD', 'Übrige Welt', '{}', true, 30, true, '2026-07-22 19:39:04.472802+00', '2026-07-22 19:39:04.472802+00');


--
-- Data for Name: system_settings; Type: TABLE DATA; Schema: public; Owner: -
--

INSERT INTO public.system_settings VALUES
	('anomaly.sigma_threshold', '3.0', 'Z-score threshold for anomaly alerts. ADMIN-tunable 2.0–4.0 (ADR-0019 §6).', NULL, '2026-06-03 14:14:02.085666+00', '2026-06-03 14:14:02.085666+00'),
	('appointment.no_show_grace_minutes', '30', 'Grace period before auto-no-show (ADR-0020 §7).', NULL, '2026-06-03 14:14:02.085666+00', '2026-06-03 14:14:02.085666+00'),
	('appointment.viewing_default_duration_minutes', '45', 'Default duration for VIEWING appointments (ADR-0020 §1).', NULL, '2026-06-03 14:14:02.085666+00', '2026-06-03 14:14:02.085666+00'),
	('appointment.buyback_eval_default_duration_minutes', '30', 'Default duration for BUYBACK_EVAL appointments.', NULL, '2026-06-03 14:14:02.085666+00', '2026-06-03 14:14:02.085666+00'),
	('appointment.consultation_default_duration_minutes', '20', 'Default duration for CONSULTATION appointments.', NULL, '2026-06-03 14:14:02.085666+00', '2026-06-03 14:14:02.085666+00'),
	('appointment.pickup_default_duration_minutes', '15', 'Default duration for PICKUP appointments.', NULL, '2026-06-03 14:14:02.085666+00', '2026-06-03 14:14:02.085666+00'),
	('kyc.cumulative_dd_threshold_eur', '"15000.00"', 'Cumulative customer spend that triggers enhanced DD over the lookback window.', NULL, '2026-06-03 14:14:02.085666+00', '2026-06-03 14:14:02.085666+00'),
	('kyc.dd_lookback_months', '12', 'Lookback window for cumulative-spend due-diligence.', NULL, '2026-06-03 14:14:02.085666+00', '2026-06-03 14:14:02.085666+00'),
	('smurfing.ankauf_count_threshold', '3', 'Number of near-threshold Ankauf transactions that triggers a flag.', NULL, '2026-06-03 14:14:02.085666+00', '2026-06-03 14:14:02.085666+00'),
	('smurfing.ankauf_amount_near_threshold_eur', '"1999.00"', '"Just-below-€2000" threshold for smurfing flag.', NULL, '2026-06-03 14:14:02.085666+00', '2026-06-03 14:14:02.085666+00'),
	('cash_drawer.variance_alert_threshold_eur', '"5.00"', 'Cash drawer variance above which closing requires ADMIN review.', NULL, '2026-06-03 14:14:02.085666+00', '2026-06-03 14:14:02.085666+00'),
	('shop.tagline', '""', 'Handelszeile unter dem Ladennamen auf dem Beleg. LEER ausgeliefert: sie gehoert dem Haendler.', NULL, '2026-06-03 14:14:04.161715+00', '2026-06-03 14:14:04.161715+00'),
	('shop.address_line2', '""', 'Anschriftzeile 2 (PLZ + Ort). LEER ausgeliefert: sie gehoert dem Haendler.', NULL, '2026-06-03 14:14:04.161715+00', '2026-06-03 14:14:04.161715+00'),
	('gwg.verkauf_identity_threshold_unbar_eur', '"15000.00"', NULL, NULL, '2026-07-26 10:00:40.139062+00', '2026-07-26 10:00:40.139062+00'),
	('calendar.pull_sync_token', '""', 'Google Calendar incremental sync token', NULL, '2026-06-13 01:46:41.317336+00', '2026-07-30 16:17:14.950231+00'),
	('smurfing.ankauf_count_window_days', '30', 'Rolling window for smurfing detection (ADR-0007).', NULL, '2026-06-03 14:14:02.085666+00', '2026-06-07 05:27:29.57318+00'),
	('gwg.verkauf_identity_threshold_eur', '"2000.00"', 'VERKAUF: buyer ID required when the sale total >= this (GwG §10). Below it: anonymous sale allowed. Roman Grützner go-live sign-off.', NULL, '2026-06-07 05:27:29.57318+00', '2026-06-07 05:27:29.57318+00'),
	('gwg.ankauf_identity_required_always', 'true', 'ANKAUF: seller ID required for EVERY buy from EUR 0.01 (hard §259 StGB). Documentation of the binding policy — the trigger enforces it unconditionally and intentionally does NOT read this flag, so the rule cannot be disabled.', NULL, '2026-06-07 05:27:29.57318+00', '2026-06-07 05:27:29.57318+00'),
	('kyc.high_value_threshold_eur', '"2000.00"', 'SUPERSEDED by gwg.verkauf_identity_threshold_eur (the enforced key). Realigned from EUR 10.000 to Roman''s EUR 2.000 Verkauf line so thresholds do not disagree.', NULL, '2026-06-03 14:14:02.085666+00', '2026-06-07 05:27:29.57318+00'),
	('shop.name', '""', 'Shop name printed on the receipt header.', NULL, '2026-06-03 14:14:04.161715+00', '2026-07-30 08:15:43.550983+00'),
	('pricing.ankauf_safety_margin_pct.gold', '0.05', 'Ankauf safety margin for gold as a fraction (0.10 = 10%). Owner-editable.', NULL, '2026-06-04 15:39:46.257106+00', '2026-07-30 08:17:09.855929+00'),
	('shop.vat_id', '""', 'USt-IdNr. printed on the receipt. PROVISIONAL — replace with the real id.', NULL, '2026-06-03 14:14:04.161715+00', '2026-07-30 08:15:43.647053+00'),
	('shop.address_line1', '""', 'Anschriftzeile 1 (Strasse + Nummer). LEER ausgeliefert: sie gehoert dem Haendler.', NULL, '2026-06-03 14:14:04.161715+00', '2026-07-22 17:39:21.05458+00'),
	('pricing.ankauf_safety_margin_pct.silver', '0.3', 'Ankauf safety margin for silver as a fraction (0.10 = 10%). Owner-editable.', NULL, '2026-06-04 16:03:21.416714+00', '2026-06-10 00:30:06.245433+00'),
	('appointments.business_hours', '{"sa": ["10:00", "14:00"], "so": null, "mo-fr": ["10:00", "18:00"]}', 'Öffnungszeiten für die Online-Terminbuchung (Europe/Berlin). Bänder: mo-fr, sa, so; null = geschlossen; 30-Minuten-Raster.', NULL, '2026-06-10 18:14:03.605722+00', '2026-06-10 18:14:03.605722+00'),
	('shop.phone', '""', 'Shop phone printed on the receipt. PROVISIONAL — replace with the real number.', NULL, '2026-06-03 14:14:04.161715+00', '2026-07-22 17:39:21.05458+00'),
	('pricing.ankauf_safety_margin_pct', '0.05', 'Ankauf safety margin as a fraction (0.10 = 10%). Buy rate = 10-day average × (1 − pct). Owner-editable via PATCH /api/metal-prices/margin (step-up). Epic A Phase A3.', NULL, '2026-06-03 14:14:03.599594+00', '2026-06-16 16:05:41.802631+00'),
	('lbma.latest_fix', '{"source": "gold-api.com", "goldEur": "115.8446", "provider": "gold_api_com", "fetchedAt": "2026-07-30T16:14:52Z", "silverEur": "1.6601", "platinumEur": "46.7016", "palladiumEur": "37.3556"}', 'Latest LBMA gold/silver/platinum fix (worker-populated every 15 min during market hours).', NULL, '2026-06-03 14:14:02.085666+00', '2026-07-30 16:15:00.241271+00'),
	('calendar.watch_channel', '{"id": "3719d9a7-12e0-471e-b2de-5d1ddd2ec306", "expiration": 1785874963000, "resourceId": "7nkG4Y9T2G8P9UlGfHlIHP_u_pM"}', 'Google Calendar watch channel', NULL, '2026-06-13 02:00:59.464831+00', '2026-07-28 20:22:44.731749+00'),
	('datev.sachkontenrahmen', '"SKR03"', 'DATEV-Kontenrahmen: SKR03 oder SKR04. Vorgabewert SKR03, der haeufigste Rahmen im deutschen Einzelhandel. Steht in datev.platzhalter und wird der Oberflaeche als UNBESTAETIGT ausgewiesen, bis der Haendler ihn mit seinem Steuerberater abgleicht.', NULL, '2026-07-26 16:05:10.855796+00', '2026-07-26 16:05:10.855796+00'),
	('datev.sachkontenlaenge', '4', 'Stellenzahl der Sachkonten, vier bis acht. Vorgabewert 4: SKR03 und SKR04 sind vierstellig. Muss zum Bestand des Steuerberaters passen.', NULL, '2026-07-26 16:05:10.855796+00', '2026-07-26 16:05:10.855796+00'),
	('datev.festschreibung', 'false', 'Kopf-Feld 21 und Satz-Feld 114. Vorgabewert false, damit der Steuerberater den ersten Stapel noch korrigieren und anhängen kann.', NULL, '2026-07-26 16:05:10.855796+00', '2026-07-26 16:05:10.855796+00'),
	('datev.wirtschaftsjahr_beginn', '"01-01"', 'Beginn des Wirtschaftsjahres als MM-TT. Regelfall 01-01 (Kalenderjahr), abweichend etwa 07-01. Das JAHR wird seit dem 06.08.2026 aus dem Buchungstag gerechnet: ein fester Jahreswert buchte ab dem 1. Januar des zweiten Betriebsjahres JEDE Ausfuhr ein Jahr zu frueh.', NULL, '2026-07-26 16:05:10.855796+00', '2026-07-26 16:05:10.855796+00'),
	('steuer.modus', '""', 'Umsatzsteuer-Status des Betriebs: REGELBESTEUERUNG oder KLEINUNTERNEHMER_19. LEER AUSGELIEFERT, und das ist Absicht: ohne diesen Wert verweigert finalize jeden Verkauf (lib/steuermodus.ts). Eine Kasse, die nicht weiss, ob ihr Betreiber Kleinunternehmer nach Paragraph 19 UStG ist, darf keine Umsatzsteuer ausweisen. Der Haendler erklaert ihn im Einrichtungsprogramm.', NULL, '2026-07-27 02:48:14.128594+00', '2026-07-27 02:48:14.128594+00'),
	('steuer.modus_gilt_ab', '""', 'Ab wann der Modus gilt, JJJJ-MM-TT. LEER ausgeliefert; wird mit dem Modus zusammen gesetzt und muss VOR dem aeltesten Vorgang liegen.', NULL, '2026-07-27 02:48:14.128594+00', '2026-07-27 02:48:14.128594+00'),
	('datev.platzhalter', '["datev.beraternummer", "datev.festschreibung", "datev.mandantennummer", "datev.sachkontenlaenge", "datev.sachkontenrahmen", "datev.wirtschaftsjahr_beginn"]', 'Die DATEV-Schluessel, deren Wert aus einem Vorgabewert stammt und den NIEMAND bestaetigt hat. Die Oberflaeche weist sie als UNBESTAETIGT aus. Wird ein Schluessel gespeichert, nimmt der Server ihn aus dieser Liste.', NULL, '2026-07-26 16:05:10.855796+00', '2026-07-27 15:18:31.945785+00'),
	('shop.legal_name', '""', NULL, NULL, '2026-07-28 00:59:11.855887+00', '2026-07-28 00:59:11.855887+00'),
	('shop.street', '""', NULL, NULL, '2026-07-28 00:59:11.855887+00', '2026-07-28 00:59:11.855887+00'),
	('shop.postal_code', '""', NULL, NULL, '2026-07-28 00:59:11.855887+00', '2026-07-28 00:59:11.855887+00'),
	('shop.city', '""', NULL, NULL, '2026-07-28 00:59:11.855887+00', '2026-07-28 00:59:11.855887+00'),
	('shop.country_code', '""', NULL, NULL, '2026-07-28 00:59:11.855887+00', '2026-07-28 00:59:11.855887+00'),
	('shop.tax_number', '""', NULL, NULL, '2026-07-28 00:59:11.855887+00', '2026-07-28 00:59:11.855887+00'),
	('datev.beraternummer', '"1001"', 'Beraternummer der Kanzlei (Kopf-Feld 4). Vorgabewert 1001 als Platzhalter; der Steuerberater biegt den Stapel beim Import um. Steht in datev.platzhalter.', NULL, '2026-07-28 00:59:11.855887+00', '2026-07-28 00:59:11.855887+00'),
	('datev.mandantennummer', '"99999"', 'Mandantennummer dieses Ladens im Bestand der Kanzlei (Kopf-Feld 5). Vorgabewert 99999 als Platzhalter, siehe datev.beraternummer.', NULL, '2026-07-28 00:59:11.855887+00', '2026-07-28 00:59:11.855887+00'),
	('kasse.seriennummer', '""', NULL, NULL, '2026-07-28 00:59:11.855887+00', '2026-07-28 00:59:11.855887+00'),
	('appointments.ics_feed_token', '""', 'Geheimer Zugriffstoken für den iCalendar-Termin-Feed (GET /api/appointments/feed.ics). Rotation über POST /api/appointments/feed-token.', NULL, '2026-07-29 15:35:01.935965+00', '2026-07-29 15:35:11.248271+00');


--
-- Data for Name: tax_treatment_codes; Type: TABLE DATA; Schema: public; Owner: -
--

INSERT INTO public.tax_treatment_codes VALUES
	('MARGIN_25A', 'Differenzbesteuerung', 'Margin tax', NULL, '§25a UStG', true, '2026-06-03 14:14:01.673804+00', '2026-06-03 14:14:01.673804+00'),
	('INVESTMENT_GOLD_25C', 'Anlagegold (steuerbefreit)', 'Investment gold (VAT-exempt)', 0.0000, '§25c UStG', true, '2026-06-03 14:14:01.673804+00', '2026-06-03 14:14:01.673804+00'),
	('STANDARD_19', 'Standardumsatzsteuer 19%', 'Standard VAT 19%', 0.1900, '§12 Abs. 1 UStG', true, '2026-06-03 14:14:01.673804+00', '2026-06-03 14:14:01.673804+00'),
	('REDUCED_7', 'Ermäßigte Umsatzsteuer 7%', 'Reduced VAT 7%', 0.0700, '§12 Abs. 2 UStG', true, '2026-06-03 14:14:01.673804+00', '2026-06-03 14:14:01.673804+00'),
	('MIXED', 'Gemischte Besteuerung', 'Mixed taxation', NULL, 'UStG', true, '2026-06-03 14:14:03.891265+00', '2026-06-03 14:14:03.891265+00'),
	('REVERSE_CHARGE_13B', 'Steuerschuldnerschaft des Leistungsempfängers (§13b UStG)', 'Reverse charge (§13b UStG)', 0.0000, '§13b Abs. 2 Nr. 9 UStG', true, '2026-06-03 14:14:03.891265+00', '2026-06-03 14:14:03.891265+00');


--
-- PostgreSQL database dump complete
--


