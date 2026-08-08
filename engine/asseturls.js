// engine/asseturls.js — Central asset CDN registry.
// Every user-uploaded asset lives on the Supabase CDN under a UUID filename.
// Game code keeps referring to assets by their friendly local name
// (e.g. "assets/2D/textures/base/rock.png"); assetUrl() resolves the basename to
// the absolute CDN URL. Unknown names pass through unchanged (with a warning)
// so same-origin files keep working.

export const ASSET_BASE =
  "https://vtelpopqybfytrgzkomj.supabase.co/storage/v1/object/public/game-assets/public/9f509457-a9ea-4f36-833c-dd820c597ef0/2834cb21-5c96-4c92-864b-473aa85f869d/";

// friendly filename → UUID filename on the CDN (or an absolute /api path).
const ASSET_FILES = {
  // ---- 3D models -------------------------------------------------------------
  "ahura.glb": "3a743297-6d88-4481-90c2-3a2221e42cf3.glb",

  // ---- Textures --------------------------------------------------------------
  "grass.png":    "e0f8e000-1002-4a63-be83-71e8ff30ae5a.png",
  "dirt.png":     "1bca9659-849c-4189-878f-ec26cb98b5d8.png",
  "rock.png":     "b92a3b02-d739-483a-a756-90f11986c384.png",
  "sand.png":     "917630fc-04f3-47fd-88d4-50f2749bc86c.png",
  "snow.png":     "8a390867-ce85-4fdc-9de9-c3a9ed9b9fa2.png",
  "ice.png":      "7f90c172-23db-4b8e-af5c-7b15ebae1a63.png",
  "candy.png":    "087ee6e2-3621-4acc-8c0b-56999a153e57.png",
  "volcanic.png": "4a631b32-11c3-4007-bedb-ca5100516623.png",
  "water_a.png":  "cf43ba70-217b-49e3-9bd4-f9ba509083c6.png",
  "water_b.png":  "f472a17a-51a9-4477-ada7-73cf39c2603e.png",
  "fuji_sky_layer_back.png":   "ab07fa5a-4b43-4697-abfc-f91dd0b95be1.png",
  "fuji_sky_layer_middle.png": "95ab2f82-274b-4fb8-bb66-1bfc53623209.png",
  "fuji_sky_layer_front.png":  "68299f66-c5d3-4856-93c4-70a7f873cc8d.png",

  // ---- Sprites ---------------------------------------------------------------
  "headlight_flare.png": "f3376e80-dc76-48d2-aecd-7a91f4b499ea.png",
  "lightray.png":        "44ca3012-2076-424e-9587-3160ac5d9b8c.png",
  "smoke_anim.png":      "eae8cad3-0c46-4f53-935c-b4ebcbbb4f37.png",
  "pine_sway.gif":       "3bd035f3-b211-46d5-9a03-3a408e7f7e3e.gif",
  "devLOGO.png":         "e4e7bf57-a03f-4e3c-b0d1-6160e9801078.png",
  "StarLogoWithTransparentBg512x512.png": "a6153304-c13e-41ed-a73a-cafc8ecc6696.png",

  // ---- Position digits (big numbers, 64x82) -----------------------------------
  "0.png": "e2e0acb8-7148-492f-a633-c4948f6809c4.png",
  "1.png": "ae4f07c7-3b22-40fe-8ace-c08f0438e256.png",
  "2.png": "b5ace7d8-a012-4ea1-82db-3241a18f5fbb.png",
  "3.png": "b9104165-abed-4f4c-b8cc-c155117bd9bb.png",
  "4.png": "3167fa0a-70df-432b-9b04-49bd647d8623.png",
  "5.png": "f8aaf771-2bb7-4813-ab5b-e399331c4dc9.png",
  "6.png": "fb18d491-23bc-4ade-82bc-50eb85fca923.png",
  "7.png": "132ed520-297a-44f7-b2cd-4f9604c23059.png",
  "8.png": "13db9423-5a9c-41a7-8e06-b46b18afabe0.png",
  "9.png": "45143866-f465-4977-a2f9-124565510844.png",

  // ---- Speedometer digits (small numbers, 32x42) ------------------------------
  "small0.png": "4d933ac2-e6d5-4aab-a2ed-cb0b23b0b700.png",
  "small1.png": "367a8fb9-9da5-4c25-8817-f67fb023a08c.png",
  "small2.png": "ae71fd44-3b0d-4def-8f09-0bf12fa4f673.png",
  "small3.png": "bbd86b01-4d71-4a50-8829-22960ba977b2.png",
  "small4.png": "b64031a9-1c4a-4b54-99c6-e68ce5e9e5af.png",
  "small5.png": "e9fe075a-de07-49ad-bcf6-1d2456758a5c.png",
  "small6.png": "eaa79884-fd02-42b1-b33d-d18bf2a49387.png",
  "small7.png": "c485ba39-40ae-4402-b623-dc87ff06c92e.png",
  "small8.png": "39e59919-62c0-4fef-90ed-e5374c781762.png",
  "small9.png": "92dd4718-6bb5-4057-b24e-67ec28b82190.png",

  // ---- Position ordinals (big, 64x82) -----------------------------------------
  "1st.png": "0e95ebea-24e7-4e56-984f-1841e225561d.png",
  "2nd.png": "f403db28-ab13-4c52-b45c-2c22e8083752.png",
  "3rd.png": "d6b1b84f-8267-41f2-b858-1c225745e65c.png",

  // ---- Bigfont title letters (X_.png, 32x64) -----------------------------------
  "A_.png": "10b1808c-1036-48d4-818a-d3e2dd8d9908.png",
  "B_.png": "d7a2f44e-b0cd-4c01-a058-cebd6cc19c05.png",
  "C_.png": "422e035a-7eb4-4dda-b27a-bda086189924.png",
  "D_.png": "d8215ab5-361a-4111-b94f-0585b1959573.png",
  "E_.png": "ad16cd35-8446-4f4d-bb12-b3a1835bdb17.png",
  "F_.png": "b434de96-f120-4832-94af-0aebc1332441.png",
  "G_.png": "97c5e024-c239-4a9c-a823-4740b70ba79c.png",
  "H_.png": "3530f775-36ee-442b-8df0-875ab2c15256.png",
  "I_.png": "6abb8cc2-df26-4f6a-8f5c-7cc6341c1b70.png",
  "J_.png": "d3d8d3d7-3c6f-4206-a836-cd934ea6dd15.png",
  "K_.png": "dd4a47d8-88ce-45bb-837c-ab2166c1c699.png",
  "L_.png": "fc9d875e-fde6-4065-aad6-c5c16a889433.png",
  "M_.png": "9d50ece5-fe41-4316-96f5-e7255deebd13.png",
  "N_.png": "af119265-c8ac-4efd-a468-d808288f28dd.png",
  "O_.png": "5025f493-eaed-48d2-be30-579db7fc1d75.png",
  "P_.png": "50386978-0b42-4af2-a187-2a7297a45ca6.png",
  "Q_.png": "b9d76fb6-b178-4666-b696-7091b80308a4.png",
  "R_.png": "ce6b8ceb-0ae5-4699-8f70-cbbab13924a7.png",
  "S_.png": "92f23596-8745-4b5b-881a-6aad48e30625.png",
  "T_.png": "e30b44d0-1889-4527-b05f-517c2e459651.png",
  "U_.png": "d441afd8-d51d-4fba-9ecc-326c02ca7075.png",
  "V_.png": "4e284133-a41a-418a-9189-2ce3c501c3bf.png",
  "W_.png": "3e489ac0-c5d0-4519-be2b-b82effb43079.png",
  "X_.png": "95ae7a1b-2b07-41ae-a240-19fb3c41c142.png",
  "Y_.png": "e082d8ec-9b8e-403f-a339-5015d9bb710b.png",
  "Z_.png": "267f9823-87b0-451a-9486-8ce4ce1713a2.png",

  // ---- Smallfont uppercase (16x16) ---------------------------------------------
  "A.png": "f9138336-46df-4147-bed3-c52290f4250a.png",
  "B.png": "9a8cb5b1-359c-4157-b277-d10e1603f8d2.png",
  "C.png": "a9f820a7-9dc7-4bdd-a75e-7f73ce593c21.png",
  "D.png": "88d4bb2f-bca4-40ce-b2ed-6263a4fe2748.png",
  "E.png": "7023eb07-d6da-4299-80e2-092891422d54.png",
  "F.png": "0814f2a1-2ae6-45a8-81b7-e9120cd38074.png",
  "G.png": "73b3c6eb-2018-4cd4-b6b2-85d777ee3b53.png",
  "H.png": "a7e76d1c-e920-4440-9e09-0f8f8dba8981.png",
  "I.png": "1a5e165b-00fe-4834-b838-0f51e9b8e5b7.png",
  "J.png": "ff9a9781-d7fa-410d-b0f6-bff80f8484e8.png",
  "K.png": "8bfff8e1-a12e-455e-8d76-fb60f3cd3e33.png",
  "L.png": "38d1dbdf-ae4a-44ff-9a30-08c6c3ee56c9.png",
  "M.png": "197167f5-9162-4b67-9295-8d8f8b71ddaf.png",
  "N.png": "98c48c7b-91e5-4713-9dd9-acd8404e59bf.png",
  "O.png": "dbe3cf3e-5833-4ad3-b95f-f091a1c357f9.png",
  "P.png": "6ecc3da8-99cf-43d5-8e19-2b1835cc9d7c.png",
  "Q.png": "53ca9e45-bcb5-4036-be78-3b3d89da9d22.png",
  "R.png": "691f02e0-58a4-406a-8ec1-acce52b319e4.png",
  "S.png": "f073eb62-073b-4f00-a8e8-48f87bcaf4b2.png",
  "T.png": "c163ae3e-9e7a-4e63-8703-4ac1c7110f8f.png",
  "U.png": "72ab0135-b4a4-4757-bf71-b1625109837c.png",
  "V.png": "bcc08a08-a30c-45b5-bc68-27c331bfb7ce.png",
  "W.png": "a94b8e20-eb67-4238-ba28-1f2f243f931b.png",
  "X.png": "cfa531c4-200a-48cb-9477-f24f4077597d.png",
  "Y.png": "495d7d50-c575-4126-a742-0d9398d6f089.png",
  "Z.png": "54a0c281-32f4-499a-bd58-8765f75f22f1.png",

  // ---- Smallfont lowercase (16x16) ----------------------------------------------
  "a.png": "debc0808-dd2f-4046-be35-2bd14d735141.png",
  "b.png": "0da2415b-561f-4929-a819-4a96359e748a.png",
  "c.png": "ac4fe212-d331-407e-b5db-19ce54fe17b4.png",
  "d.png": "8442d6e4-5543-4b73-94f7-95285f8bdd44.png",
  "e.png": "6dfa11f2-5b51-40a2-a793-a6a0db830e3c.png",
  "f.png": "4d853585-28a0-4cc4-8671-9522c08a3772.png",
  "g.png": "69a17b0b-066c-46ec-b899-bb6017d5271b.png",
  "h.png": "93c5acd0-3c8a-4e07-8275-321fba682353.png",
  "i.png": "3a98d5d4-db51-4020-b8e0-6d803631fa2e.png",
  "j.png": "c77bee89-93f8-4079-beb3-6e13dc4f1603.png",
  "k.png": "fe432cd5-af12-4363-94a8-cd492c2a25f0.png",
  "l.png": "f42dd584-9c80-4961-810e-eb54cefe92f2.png",
  "m.png": "ee142d75-c651-4f8d-a980-f895d086fe78.png",
  "n.png": "1fae41ce-88b5-4d2e-8f35-5c66c41ae2f5.png",
  "o.png": "3892bdcb-f366-4752-999c-f9da1ba9f227.png",
  "p.png": "5a8c0b75-474c-46c9-a814-967471e98e9c.png",
  "q.png": "a147fc1c-42b1-4fb7-b7e3-e9bc60712a3e.png",
  "r.png": "2670165c-73a7-44cf-8f93-58d72c27a4d8.png",
  "s.png": "3fe1abee-3446-4f58-ab2c-c54aefc24b9b.png",
  "t.png": "78b002cd-67b7-4fcd-aafd-2cbb94ce3f7b.png",
  "u.png": "285c467d-5a4d-443e-828d-e607530066dc.png",
  "v.png": "7a05ce89-9611-43d5-baff-5236e2193111.png",
  "w.png": "0a041eb8-ef08-4869-b8a2-4af806fa26b7.png",
  "x.png": "2cd338d0-9e29-413e-a95f-849e70504354.png",
  "y.png": "d6b2429a-499f-4f23-a854-ae51f7c98a46.png",
  "z.png": "3d2451db-9362-4620-bdcd-73153e6349a5.png",

  // ---- Smallfont punctuation ------------------------------------------------------
  "period.png":      "09257de7-01f7-453f-a4ee-ffd7afdfb5d6.png",
  "comma.png":       "0c59a52b-6300-4f47-80f3-2c8560fe1102.png",
  "semicolon.png":   "0fedce35-2677-41e9-bbcc-c81d9cdef521.png",
  "colon.png":       "93aef308-fd4d-479d-91ca-8acdd26a0da2.png",
  "exclamation.png": "e065e2bf-9b97-49b1-b069-edaba8c2ce40.png",
  "question.png":    "6231d3cc-1991-4371-910d-d171bc40e987.png",
  "plus.png":        "04ae0527-8fdb-494d-ba89-999837beb369.png",
  "dash.png":        "8ec125d4-a152-409b-b114-16d4fdcc5b9d.png",
  "tick.png":        "801e5f73-9d07-40e7-9c91-06654a60e769.png",
  '".png':           "f1aa51cf-8898-4bf5-952f-7b8bdfe3621c.png",
  "(.png":           "11db8172-f1fa-4184-a9fd-2a9b5029c1e1.png",
  ").png":           "b91c5f7b-18d6-446c-8674-a52641e9ee5f.png",
  "slash.png":       "c345e77f-dd2d-4346-93b7-89f194dfad95.png",
  "title1.png":      "59413577-a69b-44c6-b699-7d44fe96f8ae.png",

  // ---- Soundtrack (22 tracks) --------------------------------------------------------
  "1._collector.mp3":      "ebd3c521-fc52-4807-a63f-91a12316ac3e.mp3",
  "2._hoarder.mp3":        "e5457143-59bb-44bc-b40d-eaf6c360e749.mp3",
  "3._ahura.mp3":          "605fa010-0ec1-4d4d-b725-94701ec3c5bd.mp3",
  "4._lost_triplet.mp3":   "78ce6c8c-a6e4-41ec-8953-c5b31f8d0494.mp3",
  "5._neon_static.mp3":    "c52a357c-f61b-4a2f-848e-b583ddf8437a.mp3",
  "6._piston_pusher.mp3":  "5fe3fac9-e3be-4dd1-9702-2866f8631235.mp3",
  "7._incline.mp3":        "d2557263-1859-497c-9de6-fea50633e8ea.mp3",
  "8._octane.mp3":         "d7a732fc-6dab-445e-9063-59577a4c6cae.mp3",
  "9._untitled.mp3":       "a2a3bdbc-7ed9-4591-adcc-11ff2d17ee25.mp3",
  "10._hairpin.mp3":       "f5ae0209-6698-41ed-a822-690c89b6bf20.mp3",
  "11._liquid.mp3":        "3ecb3900-7e9f-4dc9-8f75-5c89b2e3cf17.mp3",
  "12._chrome_coil.mp3":   "1b938730-e39c-49d3-9780-85340bc68ac3.mp3",
  "13._satin_fuse.mp3":    "3e9e9788-ca14-4dd5-8dad-076414d58c28.mp3",
  "14._spline_force.mp3":  "e2859bcc-1d08-424b-a85d-ee8fd0ca3de2.mp3",
  "15._redline.mp3":       "bf93e972-dafa-49a1-a8db-9f795283e650.mp3",
  "16._whitewall.mp3":     "b46240b1-c160-4fe9-938a-a012f085a2f3.mp3",
  "17._paper_boats.mp3":   "cf4a1369-2631-487d-92d2-c48433788558.mp3",
  "18._acid_rain.mp3":     "9c48181e-7dd9-4d7b-b225-54b746deb1e4.mp3",
  "19._pavement.mp3":      "9762daf8-55a8-4609-96c7-0f4ff3937b18.mp3",
  "20._rollcage.mp3":      "53e90423-f1e5-487f-af69-ab787898ce4e.mp3",
  "21._close_shave.mp3":   "011ed98d-e745-466c-8b03-c61e0f81326c.mp3",
  "22._u-turn.mp3":        "12a6f3d3-c5ba-4474-931d-88bf6ce0a296.mp3",

  // ---- SFX -----------------------------------------------------------------------------
  "sfx_engine_loop.mp3":  "9010b76b-3c7e-46c3-a5f2-162b6dce4a09.mp3",
  "sfx_screech_loop.mp3": "d1a66fa9-c8bf-4db2-8db1-4d285edb4ef3.mp3",
  "sfx_crash.mp3":        "5ffac330-7270-4ad2-a63c-220432978526.mp3",
  "sfx_crunch.mp3":       "ea206415-b92c-4b2f-b277-57319b2d3494.mp3",
  "sfx_boost.mp3":        "cec59e1e-a725-4f77-b164-efd34ef93378.mp3",
  "sfx_tierup.mp3":       "46e58d9e-685e-4e61-b0f4-2e5a299719e3.mp3",
};

/**
 * Resolve a friendly asset path (any directory prefix is ignored; only the
 * basename matters — the CDN bucket is flat) to its absolute URL.
 * Unknown names return the input unchanged so same-origin paths still work.
 */
export function assetUrl(path) {
  const name = String(path).split("/").pop();
  const f = ASSET_FILES[name];
  if (!f) {
    console.warn("[asseturls] no CDN mapping for:", path);
    return path;
  }
  // Values containing a "/" are full or same-origin paths (e.g. "/api/…",
  // "https://…", "assets/W_.png"); bare filenames live in the flat CDN bucket.
  return f.includes("/") ? f : ASSET_BASE + f;
}
