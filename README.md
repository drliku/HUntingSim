# Wildwood — Wildlife Hunting Simulator

A lightweight first-person wildlife simulator that runs in the browser (Three.js + plain JavaScript, no build step).
Explore a procedurally generated forest, read animal tracks, study wildlife through binoculars, learn from the
educational Field Guide (with an anatomy viewer), and hunt if you choose. No missions, levels or XP, and no gore:
animals that are hit lie down and fade away.

## Running locally

ES modules need to be served over HTTP; opening `index.html` directly from disk will not work.

**Windows:** double-click `start.bat` (requires [Node.js](https://nodejs.org)). It opens `http://localhost:8080`.

**Any OS:**

```bash
node server.js 8080
```

Then open <http://localhost:8080>. Any static server works too (for example `npx serve` or `python -m http.server 8080`).

Three.js r160 loads from the jsDelivr CDN, so the first launch needs an internet connection. Everything else
(models, textures and sounds) is generated procedurally at startup, so there are no asset downloads.

## PvP survival (play with friends)

PvP needs the game's own server, so it does not work on the shared claude.ai page.

1. On the host computer run `start.bat` (or `node server.js 8080`). The console prints the address friends on the same Wi-Fi should open, for example `http://192.168.1.7:8080`. Allow Node through the Windows firewall when asked.
2. Main menu → **PvP survival** → enter a name → **Host a game**. You get a 4-letter code (shown at the top of the screen).
3. Friends open that address, choose **PvP survival**, type the code and press **Join game**. Up to 6 players.
4. To play over the internet instead of Wi-Fi, forward the port on the host's router or use a tunnel (for example `cloudflared tunnel --url http://localhost:8080`) and share that address.

How it plays: survival rules on medium with $120 and a knife, and no poachers — the other hunters are the danger. Everyone shares one forest: the same wildlife, time, weather, doors, campfires, wild food, bait and cabin upgrades (birds are the exception: each player sees their own flocks). Players wear coloured vests with name tags. A gunshot shows the shooter on everyone's minimap for a few seconds. Hits are scored by body part (head, body, legs) per weapon. When you die you respawn far from the others with a knife and $40; whoever killed you takes your money. Sleep does not skip time in PvP — you rest in real time, faster in bed. Hold **Tab** for the scoreboard.

**Customize hunter** (main menu or pause menu): pick your jacket (including forest and snow camo), hat and hat colour, skin tone, trousers, beard and backpack, with a 3D preview you can turn. Other players see your look, and they see the weapon you are holding in your hands: rifles and shotguns are carried low and shouldered when you aim, the revolver is held out in both hands, the bow is drawn with an arrow nocked, binoculars go up to the eyes, and every gun points where its owner is looking, with a muzzle flash when it fires. Your own first-person sleeves match your jacket. The host's game runs the wildlife, so if the host leaves, the game ends.

## Controls

| Key | Action |
| --- | --- |
| W A S D / Mouse | Move / look |
| Shift | Sprint (hold breath while scoped, which steadies the aim) |
| C (or Left Ctrl) | Toggle crouch (quieter, harder to see). Careful: Ctrl+W closes the browser tab; the game asks before leaving |
| Space | Jump |
| 1–8 | Rifle, shotgun, revolver, bow, knife, binoculars, bait, grunt call |
| Right mouse | Aim the scope or raise the binoculars |
| Left mouse | Fire (hold to draw the bow, release to shoot; place bait; blow the call) |
| Mouse wheel | Switch items (optic zoom while aiming: scope 3–9×, binoculars 4–12×) |
| R | Reload |
| E | Inspect tracks or a harvest; open/close cabin doors; use the bed (relax or sleep); light and use campfires; climb the stand ladder |
| Z | While lying in bed: go to sleep |
| T | Tracking mode (highlights fresh sign) |
| F / J / M / B | Field Guide / Journal / Map / Sandbox |
| I | Pack: health, food, rest, meat, wild food and supplies |
| H | Hide the HUD |
| Esc | Pause and settings |

## What's in the game

- **Game modes:** Free roam (explore freely, everything at the stores is free, sandbox available) or **Survival mode** on Easy, Medium or Hard. Survival starts with only a hunting knife and a little money ($150 / $100 / $60). Difficulty changes hunger speed, predator aggression and damage, the number and accuracy of poachers, poison strength, and store prices. No sandbox or fast travel in survival.
- **Death:** when health reaches zero you die (killed by a predator, shot by a poacher, starvation, exhaustion or poisoning). The game then starts over from zero: journal, money and gear are wiped.
- **Predators fight back:** wolves (in packs) and cougars may hunt you, especially at night; bears, boars and moose attack if surprised at close range; coyotes rarely. Shoot them, strike them with the knife, or get indoors and shut the door.
- **Knife:** key 5. Click to strike at close range. It brings down small animals and birds (wolves too), drives off big ones, and disarms poachers.
- **Town:** a small town on flat ground east of the cabin, with three real, enterable buildings: a **gunsmith**, a **butcher** and a **general store**, each with a sign, a shingled roof, a striped (or tin) awning, wall lanterns, porch barrels, crates and a bench, a hitching rail, a counter and a shopkeeper. Shopkeepers are full characters in work aprons who lean on the counter and turn to look at you when you come in. The gunsmith sells the rifle, shotgun, revolver, recurve bow, binoculars, ammunition and arrows (the only place to restock). The butcher buys your meat (more for cooked). The general store sells deer corn bait, a grunt call, canned beans, bandages and first-aid kits, which also treat poisoning. You can also pick up a rifle dropped by a poacher.
- **Weapons:** bolt-action rifle (scoped, any game); pump shotgun (9-pellet spread for birds and small game within 40 m, reloads shell by shell); .357 revolver (fast, short range; only vital shots stop deer-sized game); recurve bow (silent: hold to draw, sight zeroed at 20 m, arrows drop and stick where they land and can be picked up with E). Small calibres cannot cleanly take the largest game.
- **Weapon rarity:** the rifle, shotgun, revolver and bow come in five tiers — Common (gray), Uncommon (green), Rare (blue), Epic (purple) and Legendary (gold). Each tier hits harder (up to +35%, which also gives a chance to drop game a weaker shot would not), shoots tighter (up to 60% less spread), cycles, reloads and draws faster (up to 30%) and from Rare up holds extra rounds. Higher tiers get a coloured stock; Legendary weapons are gold all over, in your hands and in other players' view. Weapons bought at the gunsmith start Common; the gunsmith upgrades them one tier at a time ($60 / $120 / $220 / $400). Yellow **supply crates** (five at a time, shown on the minimap when close, new ones appear every few minutes) hold a random weapon: 45% Common, 28% Uncommon, 16% Rare, 8% Epic, 3% Legendary — a new weapon, an upgrade, or its ammo (and some cash) if yours is already as good. A poacher's dropped rifle can be any tier up to Epic. In PvP everyone sees the same crates and you lose your rarities when you die.
- **Bait and calls:** place deer corn bait (key 7) and deer, elk, boar and other herbivores come to feed over the next game day. The grunt call (key 8) brings curious deer and elk closer, but can draw predators, and calling too often spooks animals.
- **Outposts:** two more trading outposts far from town, each with two stores and their own shopkeepers: the **Ridge Outpost** in the far east (Meat Market, which buys meat, and Supply Co.) and the **Lakeside Outpost** south of the lake (Guns & Ammo and a Trading Post). They sell the same goods at the same prices as the town stores.
- **Homesteads:** six more cabins with a bed are scattered around the map. In PvP every player gets a house: the host lives in the starting cabin and everyone else gets a homestead. You start a PvP game at your house and respawn there unless another hunter is waiting nearby.
- **Map icons:** the minimap and the big map (**M**) show icons for your house, other players' houses (in their jacket colour, with their name), empty cabins, every store, and the hunting stand. Your house and the stores stay pinned to the rim of the minimap when they are out of range, so you always know which way to go.
- **Store rules:** stores are open 09:00–21:00; their doors start closed, and after hours the shopkeeper goes home and the door is locked (you can always let yourself out). Walking in shows a warning: shopkeepers keep a gun under the counter, and shooting, stabbing or putting an arrow in one gets you shot dead on the spot. Point a gun (or a drawn bow) at a shopkeeper and they pull their own weapon on you (the gunsmiths a rifle, the butchers a shotgun, the storekeepers a revolver) and keep you covered until you lower it.
- **Shut your door:** sleep with the cabin door open and a wolf, cougar, coyote or bear may wander in (most likely at night) and wake you by attacking. The fortified home door latches itself.
- **Cabins:** log walls with mortar chinking and sawn end grain at the corners, stone foundations, shingled roofs with a ridge cap, glazed windows with sills and a stone chimney on the home cabin.
- **Cabin upgrades:** the board inside the starting cabin lets you build nine upgrades, each visible in and around the cabin: a feather bed (sleep restores more rest and health), a cookstove kit (cook indoors without a campfire), a larder and pack frame (carry 35 kg), a gun rack and ammo locker (buy ammunition at the cabin), a covered porch with a rocking chair you can sit in, an iron-bound door with shutters and window bars (predators and poachers cannot reach you inside), a vegetable garden that gives three safe vegetables every morning, and two **house levels**: a **renovation** (level 2: painted gables, door and window frames, flower boxes, a house sign, a weathervane and a flagstone path; sleep restores 20% more rest and extra health) and the **hunting lodge** (level 3, needs the renovation: a second log storey with a balcony, a dormer, a new roof, a tall stone chimney and a trophy rack; the butcher pays 10% more). The upper floor is for looks; you cannot go up there. They cost money in survival and are free in free roam.
- **Swimming and the whole map:** walk anywhere on the map, up to its edge, including hills and slopes (very steep climbs slow you). Deep water switches you to swimming, so you can cross the river and the lake; your weapons are lowered while you swim and you are noisy in the water.
- **Foraging:** berries, mushrooms, wild fruit, roots and cattails grow around the map. You only see a description ("Shiny black berries") until you eat one — some are deadly look-alikes such as deadly nightshade, death cap, jack-o'-lantern mushroom and poison hemlock. Death caps act hours later.
- **Cabins and sleep:** the starting cabin and a small meadow hut east of the river are fully enterable, with a bed, table and lantern, shelves, a rug and (in the big cabin) a wood stove. Doors open and close with E (a shut door blocks bullets and poachers' line of sight). At the bed, press E to lie down and relax (rest recovers slowly, time passes normally; E to get up) or to sleep for 2, 4 or 8 hours, or until dawn, dusk or midday. The forest keeps living while you sleep.
- **Survival:** Health, Food and Rest bars. Food and rest drain over time (faster when sprinting); at zero you lose health. Low rest makes your view drift and slows you down. Raw meat can cause food sickness. If health reaches zero you wake up in the cabin six hours later. Survival can be turned off in the Sandbox.
- **Meat and campfires:** inspect a harvested game animal and choose Harvest meat (you can carry 20 kg). At a campfire, hold E to light it; it burns for about five game hours (faster in rain). Press E at a lit fire to cook meat in 0.5 kg portions and eat. Press I to open your pack and eat anywhere.
- **Poachers:** armed poachers patrol the woods, investigate gunshots and shoot at you on sight. Break line of sight with trees, rocks or a cabin. Hit one and they drop their rifle and flee. They can be turned off in the Sandbox.
- **Minimap:** a north-up minimap in the top-left shows terrain, trails, cabins, campfires (lit ones glow) and poachers shooting at you. Click it, or press M, for the full map.
- **Main menu:** start or resume the hunt, open your Hunting Journal (with stats and latest entries on the menu itself), the Field Guide, settings and controls.
- **Harvest card and inspection:** after a successful shot a card shows the animal with its estimated weight and age, shot distance and placement, and species facts. Walk up to the body and press E (or use the card) to inspect it: rotate it, measure it (length, shoulder height, antlers or horns), see how biologists age it, switch to the anatomy view, then tag and record it.

- **World:** about 480 × 480 m of hills, a winding river with shallow fords, a lake, meadows, trails, a pine ridge, a cabin with a campfire and an elevated hunting stand. It has a day/night cycle with sun, moon and stars, and procedural clouds. Weather options are clear, overcast, fog, rain, storm (with lightning and thunder) and snow. Wind direction and speed shift over time.
- **Wildlife (27 species):** 16 mammals (white-tailed deer, elk, moose, pronghorn, bighorn sheep, American bison, wild boar, American black bear, gray wolf, coyote, red fox, cougar, Canada lynx, raccoon, American badger and eastern cottontail) and 11 birds: wild turkey, mallard, Canada goose, ruffed grouse, rock pigeon, mourning dove, American crow, bald eagle, red-tailed hawk, great horned owl and great blue heron. Birds walk and peck, swim, wade, perch, soar and flush as flocks. Eagles, hawks, owls and herons are legally protected and cannot be harvested. Each species has its own proportions, speeds, senses, habitat and activity pattern (crepuscular or nocturnal).
  - **Senses:** sight is tuned to movement, so a motionless hunter is hard to spot. Hearing scales with your noise, and rain or wind masks sound. Scent carries downwind, so watch the HUD wind arrow.
  - **Behaviors:** animals graze, wander, bed down, drink at the water's edge, and alert or flee. Deer flag their white tails when they run. Herds and packs move together and spread alarms. Rabbits freeze, then bolt for cover and hide. Boars may bluff-charge. Wolves and foxes stalk and chase prey without ever making a kill.
  - **Sounds:** gunshots alarm wildlife over long distances, and a missed shot's impact startles animals near it.
- **Tracking:** animals leave species-specific footprints along their real paths, plus bedding sites and boar rooting. Inspect any sign to see the species, direction of travel, freshness, gait and size, and that animal's trail is highlighted so you can follow it. Rain washes tracks away faster.
- **Optics and rifle:** the binoculars have a rangefinder, a bearing readout and live species identification; hold your view on an animal to record it. The bolt-action rifle has a variable scope, sway, hold-breath, recoil, bolt-cycling and reload animations, and a five-round magazine. Shots use segmented hitscan with gravity drop and a 100 m zero. Hits are scored by the vital zone (heart and lungs) along the bullet's path.
- **Field Guide:** scientific name, family, conservation status, habitat, diet, size, weight, lifespan, speed, activity, facts and a guide to tracks for each species. It includes a rotatable 3D model and an **anatomy mode** with toggleable skin, skeleton, muscle and organ layers, plus clickable labelled structures (for example the four-chambered ruminant stomach in deer and elk, and the cecum in rabbits).
- **Sandbox (B):** spawn animals, set the population of each species, set the weather, time of day and time speed, and teleport to named locations or near the closest member of a species. Toggles cover infinite ammo, observer mode (animals ignore you), revealing animals on the HUD and map, and unlocking the guide.
- **Journal (J):** a log of sightings and harvests with statistics. Progress and settings are saved in `localStorage`.

## Models

- **Smooth lofted models:** animals are built from continuous lofted shapes (body with chest, tucked waist and rump; head with skull, brow and snout; tapered legs; leaf-shaped ears; curved antlers and ridged horns) with fur shading, eye highlights, nostrils, toes, claws and split hooves painted or modelled in. Animals more than about 60 m away switch to a lighter version of the same model.
- **Hunters:** shaped torso with collar, zip and pockets, a face with eyes, brows, nose and ears, smooth hats, jointed arms with gloved hands, and legs with real knees (crouching bends the knees). Hair colour is one of the Customize hunter options.
- **Weapons:** detailed rifle (shaped stock with checkering, bolt, scope with turrets and lens), shotgun (vent rib, grooved pump, ejection port), revolver (fluted cylinder, hammer, ejector rod), laminated recurve bow, drop-point knife and armoured binoculars. Other players hold the same detailed models.
- **Trees and plants:** nearby pines have drooping, star-edged branch layers; broadleaf trees and birches have branching trunks and sunlit crowns; bushes, mossy rocks and curved grass blades. Distant trees use simpler models, and the detailed ones are off on the Low graphics setting.

## Rendering

- **Post-processing** (Medium and High): the scene is rendered in HDR with multisampled anti-aliasing, then gets a soft bloom on bright things (the sun, lanterns, street lamps, fire, muzzle flashes), gentle colour grading with cool shadows and warm highlights, and a light vignette. Low draws straight to the screen.
- **Ambient occlusion, cloud shadows and mist** (Medium and High): soft contact shading where things meet (log gaps, eaves, doorways, under trees and animals), shadows of passing clouds sweeping over the land on broken-cloud days, and low mist that settles over water and in hollows at dawn and in fog. All three are worked out from the depth buffer and cost well under a millisecond.
- **Leafy foliage** (Medium and High): nearby broadleaf trees, birches and bushes carry hundreds of leaf cards and pines have feathery needle fringes, drawn from procedural leaf and needle textures. They sway in the wind, cast dappled shadows and are anti-aliased with alpha-to-coverage. High shows them further out.
- **Surface detail** (Medium and High): wood, stone, bark, fur and cloth get procedural grain that bumps the lighting and mottles the colour, plus a soft rim of sky light along silhouettes. Steep ground shows layered rock with moss on the ledges instead of flat grey. Shadows are sharper (2048 px maps on Medium, 4096 on High), and the final image gets light contrast-adaptive sharpening and fine film grain.
- **Falling leaves** drift down under the trees, more of them when it is windy, alongside the daytime dust motes and the fireflies at dusk.
- **Animation:** animals breathe (harder after running), nod as they walk, lean into turns and flex their spines, and when calm they shake their heads, look around, flick their tails and stamp. Your weapon lags behind fast turns and springs back, tilts when you strafe, dips when you land and kicks up and to one side when fired; the camera sinks on landings and leans slightly into sideways movement. Other hunters and shopkeepers breathe and glance around; shopkeepers wipe the counter, stand with hands on hips or look about when the shop is empty, and wave when you walk in.
- **Water** knows how deep it is everywhere: teal in the shallows, dark in deep pools, foam along the shoreline, reflections of the live sky in the ripples and a sharp sun glint.
- **Terrain** has large-scale colour variation, drier yellow patches in the grass and fine grit up close.
- **Light shafts:** when you look towards a low sun, trees and hills cut rays into the light.
- **Forest floor:** the ground darkens softly under tree crowns, around rocks and beside buildings; ferns, fallen logs and old stumps fill the understory, and grass is tinted to match the dry patches in the meadows.
- **One skinned body per animal:** body, legs, neck, head and tail are a single mesh on a skeleton (spine, a three-bone neck, tail, and a hip and knee for each leg). Thighs and shoulders grow smoothly out of the body and the flanks move with the legs; knees and hocks fold as the feet swing forward, legs tuck under when bedded down, and grazing animals lower their heads in one smooth curve from the shoulders to the grass.
- **Sky:** cumulus clouds lit from the sun's side with silver linings, plus a high layer of wispy cirrus. **Distant mountains** — three hazy ranges, the highest snow-capped — ring the horizon beyond the map.
- **Atmosphere:** the haze warms when you look towards a low sun; fireflies blink over the grass at dusk and night, and pollen drifts in the daylight.
- **Wind and ground:** gusts roll across the grass, ferns and bushes in waves; fine relief in the ground catches the light; shadow edges no longer shimmer as you walk.
- **Trees and bushes** sway gently in the wind; animals catch the shadows of the trees they walk under.

## Performance notes

- Vegetation is instanced and split into chunks; whole chunks are culled by distance and by the camera frustum, and grass only renders near the player.
- Every animal is 7 meshes sharing a single vertex-coloured material. Leg animation and AI updates are reduced with distance, and animals are pooled and reused.
- Footprints are ring-buffered instanced decals drawn with a tiny custom shader.
- Rain and snow are animated entirely on the GPU, and clouds are drawn inside the sky shader.
- Shadows come from a single directional light that follows the player.
- The quality presets (Low / Medium / High in the pause menu) change resolution, shadows, grass density and view distance.

Simulating 200 s of world time with about 45 animals takes well under 1 s of CPU time.

## Project structure

```
index.html          UI markup, optics overlays, import map
css/style.css       HUD and menu styling
server.js           Zero-dependency static server
start.bat           Windows launcher
js/main.js          Boot sequence, game loop, interactions, hotkeys
js/state.js         Shared state, settings, persistence, quality presets
js/utils.js         Noise, RNG, math helpers
js/geo.js           Vertex-coloured geometry merging helpers
js/terrain.js       Height field, river/lake/fords, biomes, trails
js/vegetation.js    Instanced chunked trees, bushes, rocks, grass, colliders
js/environment.js   Sky, sun/moon, day-night, weather, precipitation, water
js/world.js         World assembly, cabin, stand, campfire, collisions, locations
js/species.js       Field guide data, model proportions, behaviour tuning
js/animalModel.js   Procedural animal rigs
js/animals.js       AI state machine, perception, herds, population manager
js/tracks.js        Footprints, bedding and rooting sign
js/player.js        Input and first-person controller
js/equipment.js     Rifle, binoculars, ballistics, viewmodel, impacts
js/anatomy.js       Skeleton, muscle and organ models with labels
js/stage.js         Shared 3D viewer for the guide, harvest card and inspection
js/birdModel.js     Procedural bird models with folding, flapping wings
js/birds.js         Bird AI: ground, water, wading, perching and soaring birds
js/survival.js      Health, food, rest, sickness and the meat you carry
js/poachers.js      Hostile poachers: patrol, search, engage, surrender
js/modes.js         Game modes, difficulty settings, stores and prices
js/forage.js        Wild plants and mushrooms, including poisonous look-alikes
js/audio.js         Procedural Web Audio sound
js/ui.js            HUD, menus, field guide preview, sandbox, map
```

## Debugging

Append `?nolock` to the URL (for example `http://localhost:8080/?nolock`) to play without pointer lock, which is
useful for automated testing. It also exposes the game state as `window.G` in the console.
