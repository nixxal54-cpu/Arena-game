/**
 * renderer.js  ─  Ultra-graphics Island map + Three.js rendering
 */
class Renderer {
    constructor(canvas) {
        this.canvas = canvas;
        this.localId = null;
        this._playerMeshes = new Map();
        this._bulletMeshes = new Map();
        this._bulletPool   = [];
        this._clock = new THREE.Clock();
        this._waterMesh = null;
        this._palmTrees  = [];
        this._clouds     = [];
        this._time       = 0;

        this._initThree();
        this._buildIsland();
        this._buildZoneRing();
        this._buildLights();
        this._buildAtmosphere();
        this._onResize();

        window.addEventListener('resize', () => this._onResize());
    }

    // ── Three.js bootstrap ────────────────────────────────────────────────────

    _initThree() {
        this.scene = new THREE.Scene();
        this.scene.background = new THREE.Color(0x87ceeb); // sky blue
        this.scene.fog = new THREE.FogExp2(0xb0d8f0, 0.006);

        this.camera = new THREE.PerspectiveCamera(
            75, this.canvas.clientWidth / this.canvas.clientHeight, 0.05, 500
        );

        this.renderer = new THREE.WebGLRenderer({
            canvas: this.canvas,
            antialias: true,
            powerPreference: 'high-performance'
        });
        this.renderer.shadowMap.enabled = true;
        this.renderer.shadowMap.type    = THREE.PCFSoftShadowMap;
        this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
        this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
        this.renderer.toneMappingExposure = 1.1;
    }

    // ── Island terrain ────────────────────────────────────────────────────────

    _buildIsland() {
        // ── Ocean floor ───────────────────────────────────────────────────────
        const seaGeo = new THREE.PlaneGeometry(400, 400, 1, 1);
        seaGeo.rotateX(-Math.PI / 2);
        const seaMat = new THREE.MeshLambertMaterial({ color: 0x003b6f });
        const seaFloor = new THREE.Mesh(seaGeo, seaMat);
        seaFloor.position.y = -4;
        this.scene.add(seaFloor);

        // ── Animated ocean surface ────────────────────────────────────────────
        const waterGeo = new THREE.PlaneGeometry(400, 400, 80, 80);
        waterGeo.rotateX(-Math.PI / 2);
        const waterMat = new THREE.MeshPhongMaterial({
            color: 0x006994,
            transparent: true, opacity: 0.82,
            shininess: 180,
            specular: new THREE.Color(0x88ddff),
        });
        this._waterMesh = new THREE.Mesh(waterGeo, waterMat);
        this._waterMesh.position.y = -0.5;
        this._waterMesh.receiveShadow = true;
        this.scene.add(this._waterMesh);
        this._waterOrigY = this._waterMesh.geometry.attributes.position.array.slice();

        // ── Island base (sculpted using vertex displacement) ──────────────────
        const islandGeo = new THREE.CylinderGeometry(52, 60, 6, 80, 8);
        const posAttr = islandGeo.attributes.position;
        for (let i = 0; i < posAttr.count; i++) {
            const x = posAttr.getX(i);
            const y = posAttr.getY(i);
            const z = posAttr.getZ(i);
            const r = Math.sqrt(x*x + z*z);
            // Sculpt edges to look like cliffs
            if (y > 0 && r > 30) {
                const noise = Math.sin(x * 0.3) * Math.cos(z * 0.3) * 1.5;
                posAttr.setY(i, y + noise);
                posAttr.setX(i, x + Math.sin(z * 0.2) * (r > 45 ? 2 : 0));
            }
        }
        islandGeo.computeVertexNormals();

        const islandMat = new THREE.MeshLambertMaterial({ color: 0x8B6914 }); // earthy brown
        const islandMesh = new THREE.Mesh(islandGeo, islandMat);
        islandMesh.position.y = -1;
        islandMesh.receiveShadow = true;
        islandMesh.castShadow   = true;
        this.scene.add(islandMesh);

        // ── Grass top layer ───────────────────────────────────────────────────
        const grassGeo = new THREE.CircleGeometry(50, 80);
        grassGeo.rotateX(-Math.PI / 2);
        // Subtle height variation
        const gPos = grassGeo.attributes.position;
        for (let i = 0; i < gPos.count; i++) {
            const x = gPos.getX(i), z = gPos.getZ(i);
            const r = Math.sqrt(x*x+z*z);
            if (r < 48) {
                const bump = Math.sin(x*0.4)*Math.cos(z*0.4)*0.35 + Math.sin(x*0.9+z*0.5)*0.15;
                gPos.setY(i, bump);
            }
        }
        grassGeo.computeVertexNormals();

        const grassMat = new THREE.MeshLambertMaterial({ color: 0x3a7d44 });
        const grassMesh = new THREE.Mesh(grassGeo, grassMat);
        grassMesh.receiveShadow = true;
        grassMesh.position.y = 0.02;
        this.scene.add(grassMesh);

        // ── Sandy beach ring ──────────────────────────────────────────────────
        const beachGeo = new THREE.RingGeometry(48, 55, 80);
        beachGeo.rotateX(-Math.PI / 2);
        const beachMat = new THREE.MeshLambertMaterial({ color: 0xd2b48c, side: THREE.DoubleSide });
        const beach = new THREE.Mesh(beachGeo, beachMat);
        beach.position.y = 0.01;
        this.scene.add(beach);

        // ── Rocky cliff edges ─────────────────────────────────────────────────
        for (let i = 0; i < 12; i++) {
            const angle = (i / 12) * Math.PI * 2;
            const r = 50 + Math.random() * 4;
            const rock = this._makeRock(
                Math.sin(angle) * r, -0.5 + Math.random() * 1,
                Math.cos(angle) * r,
                1.5 + Math.random() * 2.5
            );
            this.scene.add(rock);
        }

        // ── Inland rocks / boulders (cover) ──────────────────────────────────
        const coverPositions = [
            [14, 0, 8],  [-14, 0, 8],  [8, 0, -14], [-8, 0, -14],
            [28, 0, 2],  [-28, 0, 2],  [2, 0, 28],  [2, 0, -28],
            [20, 0, -20],[-20, 0, 20],
        ];
        coverPositions.forEach(([x, y, z], i) => {
            const size = 1.8 + (i % 3) * 0.8;
            const rock = this._makeRock(x, y, z, size);
            this.scene.add(rock);
        });

        // ── Central stone ruins / fort ────────────────────────────────────────
        this._buildRuins();

        // ── Palm trees ────────────────────────────────────────────────────────
        const palmSpots = [
            [38, 0, 10], [-38, 0, 10], [10, 0, 38], [-10, 0, 38],
            [36, 0, -14],[-36, 0, -14],[14, 0, -36],[-14, 0, -36],
            [28, 0, 28], [-28, 0, 28],
        ];
        palmSpots.forEach(([x, y, z]) => {
            const palm = this._makePalmTree(x, y, z);
            this.scene.add(palm);
            this._palmTrees.push(palm);
        });

        // ── Floating island bits (distant scenery) ────────────────────────────
        for (let i = 0; i < 5; i++) {
            const angle = (i / 5) * Math.PI * 2;
            const dist  = 120 + Math.random() * 60;
            const mini  = this._makeMiniIsland(
                Math.sin(angle) * dist, -2 + Math.random() * 1.5,
                Math.cos(angle) * dist
            );
            this.scene.add(mini);
        }

        // ── Grid helper (very faint, on grass) ────────────────────────────────
        const grid = new THREE.GridHelper(100, 25, 0x2d5a30, 0x2d5a30);
        grid.material.opacity = 0.18;
        grid.material.transparent = true;
        grid.position.y = 0.05;
        this.scene.add(grid);
    }

    _makeRock(x, y, z, size) {
        const geo = new THREE.DodecahedronGeometry(size, 0);
        // Randomise vertices slightly
        const pos = geo.attributes.position;
        for (let i = 0; i < pos.count; i++) {
            pos.setX(i, pos.getX(i) * (0.8 + Math.random() * 0.4));
            pos.setY(i, pos.getY(i) * (0.7 + Math.random() * 0.5));
            pos.setZ(i, pos.getZ(i) * (0.8 + Math.random() * 0.4));
        }
        geo.computeVertexNormals();
        const mat  = new THREE.MeshLambertMaterial({ color: 0x888877 });
        const mesh = new THREE.Mesh(geo, mat);
        mesh.position.set(x, y + size * 0.5, z);
        mesh.rotation.set(Math.random(), Math.random(), Math.random());
        mesh.castShadow = mesh.receiveShadow = true;
        return mesh;
    }

    _makePalmTree(x, y, z) {
        const group = new THREE.Group();

        // Trunk (curved using segments)
        const trunkMat = new THREE.MeshLambertMaterial({ color: 0x8B5E3C });
        const curve = new THREE.QuadraticBezierCurve3(
            new THREE.Vector3(0, 0, 0),
            new THREE.Vector3(0.6, 3, 0.3),
            new THREE.Vector3(1, 6, 0.5)
        );
        const pts = curve.getPoints(8);
        for (let i = 0; i < pts.length - 1; i++) {
            const r = 0.22 - i * 0.015;
            const seg = new THREE.CylinderGeometry(r, r + 0.02, pts[i+1].y - pts[i].y, 7);
            const m   = new THREE.Mesh(seg, trunkMat);
            m.position.copy(pts[i]).lerp(pts[i+1], 0.5);
            m.castShadow = true;
            group.add(m);
        }

        // Fronds
        const frondMat = new THREE.MeshLambertMaterial({ color: 0x2d8a4e, side: THREE.DoubleSide });
        const top = pts[pts.length - 1];
        for (let f = 0; f < 7; f++) {
            const ang = (f / 7) * Math.PI * 2;
            const geo = new THREE.PlaneGeometry(0.4, 2.8);
            const frond = new THREE.Mesh(geo, frondMat);
            frond.position.set(top.x + Math.sin(ang) * 1.2, top.y + 0.3, top.z + Math.cos(ang) * 1.2);
            frond.rotation.set(-0.4, ang, 0.3);
            frond.castShadow = true;
            group.add(frond);
        }

        // Coconuts
        const cocoMat = new THREE.MeshLambertMaterial({ color: 0x5c3d1e });
        for (let c = 0; c < 3; c++) {
            const ang = (c / 3) * Math.PI * 2;
            const coco = new THREE.Mesh(new THREE.SphereGeometry(0.18, 6, 6), cocoMat);
            coco.position.set(top.x + Math.sin(ang) * 0.4, top.y - 0.2, top.z + Math.cos(ang) * 0.4);
            group.add(coco);
        }

        group.position.set(x, y, z);
        group.rotation.y = Math.random() * Math.PI * 2;
        return group;
    }

    _buildRuins() {
        const stoneMat  = new THREE.MeshLambertMaterial({ color: 0x9e9e8e });
        const stone2Mat = new THREE.MeshLambertMaterial({ color: 0x7a7a6a });

        // Central keep
        const keepBase = new THREE.Mesh(new THREE.BoxGeometry(8, 5, 8), stoneMat);
        keepBase.position.set(0, 2.5, 0);
        keepBase.castShadow = keepBase.receiveShadow = true;
        this.scene.add(keepBase);

        // Crenellations on top
        for (let i = 0; i < 8; i++) {
            if (i % 2 === 0) continue;
            const ang = (i / 8) * Math.PI * 2;
            const cr = new THREE.Mesh(new THREE.BoxGeometry(1.2, 1.2, 1.2), stone2Mat);
            cr.position.set(Math.sin(ang) * 3.6, 5.6, Math.cos(ang) * 3.6);
            cr.castShadow = true;
            this.scene.add(cr);
        }

        // Second floor room
        const floor2 = new THREE.Mesh(new THREE.BoxGeometry(5, 3, 5), stone2Mat);
        floor2.position.set(0, 6.5, 0);
        floor2.castShadow = floor2.receiveShadow = true;
        this.scene.add(floor2);

        // Surrounding crumbled walls
        const wallSegs = [
            { x: 12, z: 0, ry: 0,    w: 6, h: 2.5 },
            { x:-12, z: 0, ry: 0,    w: 6, h: 3.5 },
            { x: 0,  z:12, ry:Math.PI/2, w: 8, h: 2 },
            { x: 0,  z:-12,ry:Math.PI/2, w: 5, h: 3 },
        ];
        wallSegs.forEach(({ x, z, ry, w, h }) => {
            const seg = new THREE.Mesh(new THREE.BoxGeometry(w, h, 0.9), stoneMat);
            seg.position.set(x, h / 2, z);
            seg.rotation.y = ry;
            seg.castShadow = seg.receiveShadow = true;
            this.scene.add(seg);
        });

        // Archway
        const archMat = stone2Mat;
        const archLeft  = new THREE.Mesh(new THREE.BoxGeometry(1.2, 4, 1.2), archMat);
        const archRight = archLeft.clone();
        const archTop   = new THREE.Mesh(new THREE.BoxGeometry(4.4, 1, 1.2), archMat);
        archLeft.position.set(-1.6, 2, -9);
        archRight.position.set(1.6, 2, -9);
        archTop.position.set(0, 4.5, -9);
        [archLeft, archRight, archTop].forEach(m => {
            m.castShadow = m.receiveShadow = true;
            this.scene.add(m);
        });

        // Scattered rubble
        for (let r = 0; r < 20; r++) {
            const ang  = Math.random() * Math.PI * 2;
            const dist = 8 + Math.random() * 14;
            const size = 0.3 + Math.random() * 0.8;
            const rub  = new THREE.Mesh(new THREE.BoxGeometry(size, size * 0.6, size), stoneMat);
            rub.position.set(Math.sin(ang) * dist, size * 0.3, Math.cos(ang) * dist);
            rub.rotation.set(Math.random(), Math.random(), Math.random());
            rub.castShadow = rub.receiveShadow = true;
            this.scene.add(rub);
        }
    }

    _makeMiniIsland(x, y, z) {
        const group = new THREE.Group();
        const base = new THREE.Mesh(
            new THREE.CylinderGeometry(5 + Math.random()*3, 7, 3, 12),
            new THREE.MeshLambertMaterial({ color: 0x8B6914 })
        );
        const top = new THREE.Mesh(
            new THREE.CircleGeometry(5, 12),
            new THREE.MeshLambertMaterial({ color: 0x3a7d44 })
        );
        top.rotation.x = -Math.PI / 2;
        top.position.y = 1.5;
        group.add(base);
        group.add(top);
        // A single palm
        const p = this._makePalmTree(Math.random() * 3 - 1.5, 1.5, Math.random() * 3 - 1.5);
        group.add(p);
        group.position.set(x, y, z);
        return group;
    }

    // ── Zone ring ─────────────────────────────────────────────────────────────

    _buildZoneRing() {
        const geo = new THREE.TorusGeometry(1, 0.3, 8, 80);
        const mat = new THREE.MeshBasicMaterial({ color: 0x00e5ff, transparent: true, opacity: 0.85 });
        this.zoneRing = new THREE.Mesh(geo, mat);
        this.zoneRing.rotation.x = -Math.PI / 2;
        this.zoneRing.position.y = 0.3;
        this.scene.add(this.zoneRing);

        const wallGeo = new THREE.CylinderGeometry(1, 1, 80, 64, 1, true);
        const wallMat = new THREE.MeshBasicMaterial({ color: 0x003c8f, transparent: true, opacity: 0.1, side: THREE.DoubleSide });
        this.zoneWall = new THREE.Mesh(wallGeo, wallMat);
        this.zoneWall.position.y = 20;
        this.scene.add(this.zoneWall);
    }

    // ── Lights ────────────────────────────────────────────────────────────────

    _buildLights() {
        const ambient = new THREE.AmbientLight(0xffeedd, 0.65);
        this.scene.add(ambient);

        // Tropical sun
        this._sun = new THREE.DirectionalLight(0xfff5cc, 2.2);
        this._sun.position.set(60, 90, 40);
        this._sun.castShadow = true;
        this._sun.shadow.mapSize.width  = 2048;
        this._sun.shadow.mapSize.height = 2048;
        this._sun.shadow.camera.near   = 1;
        this._sun.shadow.camera.far    = 300;
        this._sun.shadow.camera.left   = -70;
        this._sun.shadow.camera.right  =  70;
        this._sun.shadow.camera.top    =  70;
        this._sun.shadow.camera.bottom = -70;
        this.scene.add(this._sun);

        // Ocean bounce light (blue from below)
        const bounce = new THREE.DirectionalLight(0x44aaff, 0.4);
        bounce.position.set(-30, -10, -20);
        this.scene.add(bounce);

        // Hemisphere sky/ground
        const hemi = new THREE.HemisphereLight(0x87ceeb, 0x3a7d44, 0.5);
        this.scene.add(hemi);
    }

    // ── Atmosphere (sky dome + clouds) ────────────────────────────────────────

    _buildAtmosphere() {
        // Sky dome gradient
        const skyGeo = new THREE.SphereGeometry(450, 32, 16);
        const skyMat = new THREE.ShaderMaterial({
            side: THREE.BackSide,
            vertexShader: `
                varying vec3 vPos;
                void main() { vPos = position; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }
            `,
            fragmentShader: `
                varying vec3 vPos;
                void main() {
                    float t = clamp((vPos.y + 200.0) / 400.0, 0.0, 1.0);
                    vec3 top    = vec3(0.25, 0.55, 0.9);
                    vec3 bottom = vec3(0.68, 0.85, 1.0);
                    gl_FragColor = vec4(mix(bottom, top, t), 1.0);
                }
            `
        });
        this.scene.add(new THREE.Mesh(skyGeo, skyMat));

        // Clouds
        for (let c = 0; c < 12; c++) {
            const cloud = this._makeCloud();
            const ang   = (c / 12) * Math.PI * 2;
            const dist  = 80 + Math.random() * 120;
            cloud.position.set(Math.sin(ang) * dist, 60 + Math.random() * 30, Math.cos(ang) * dist);
            cloud.userData.speed = 0.01 + Math.random() * 0.015;
            cloud.userData.angle = ang;
            cloud.userData.dist  = dist;
            this.scene.add(cloud);
            this._clouds.push(cloud);
        }

        // Sun disc in sky
        const sunGeo  = new THREE.CircleGeometry(18, 32);
        const sunMat  = new THREE.MeshBasicMaterial({ color: 0xfffde7 });
        const sunDisc = new THREE.Mesh(sunGeo, sunMat);
        sunDisc.position.set(200, 220, -100);
        sunDisc.lookAt(0, 0, 0);
        this.scene.add(sunDisc);

        // Birds (tiny V shapes far away)
        for (let b = 0; b < 8; b++) {
            const bird = new THREE.Mesh(
                new THREE.PlaneGeometry(1.5, 0.5),
                new THREE.MeshBasicMaterial({ color: 0x223344, side: THREE.DoubleSide })
            );
            bird.position.set(
                (Math.random() - 0.5) * 200,
                50 + Math.random() * 40,
                (Math.random() - 0.5) * 200
            );
            this.scene.add(bird);
        }
    }

    _makeCloud() {
        const group = new THREE.Group();
        const mat   = new THREE.MeshLambertMaterial({ color: 0xffffff, transparent: true, opacity: 0.88 });
        const puffs = 4 + Math.floor(Math.random() * 4);
        for (let p = 0; p < puffs; p++) {
            const r    = 5 + Math.random() * 8;
            const puff = new THREE.Mesh(new THREE.SphereGeometry(r, 7, 7), mat);
            puff.position.set((Math.random()-0.5)*20, (Math.random()-0.5)*4, (Math.random()-0.5)*10);
            group.add(puff);
        }
        return group;
    }

    // ── Player meshes ─────────────────────────────────────────────────────────

    _playerColor(id) {
        let h = 0;
        for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) & 0xffffff;
        return new THREE.Color().setHSL((h % 360) / 360, 0.85, 0.55);
    }

    _getOrCreatePlayerMesh(id) {
        if (this._playerMeshes.has(id)) return this._playerMeshes.get(id);
        const group = new THREE.Group();
        const color = this._playerColor(id);
        const mat   = new THREE.MeshLambertMaterial({ color });

        const body = new THREE.Mesh(new THREE.CylinderGeometry(0.45, 0.45, 1.4, 10), mat);
        body.position.y = 0.7; body.castShadow = true;
        group.add(body);

        const headMat = new THREE.MeshLambertMaterial({ color: color.clone().multiplyScalar(1.3) });
        const head = new THREE.Mesh(new THREE.SphereGeometry(0.38, 10, 8), headMat);
        head.position.y = 1.65; head.castShadow = true;
        group.add(head);

        const gun = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.12, 0.6), new THREE.MeshLambertMaterial({ color: 0x888888 }));
        gun.position.set(0.35, 1.3, 0.5);
        group.add(gun);

        // Name label
        const lc = document.createElement('canvas');
        lc.width = 256; lc.height = 64;
        const ctx = lc.getContext('2d');
        ctx.fillStyle = 'rgba(0,0,0,0)';
        ctx.fillRect(0,0,256,64);
        ctx.font = 'bold 28px monospace';
        ctx.textAlign = 'center';
        ctx.fillStyle = '#ffffff';
        ctx.fillText(id.slice(0,12), 128, 44);
        const label = new THREE.Mesh(
            new THREE.PlaneGeometry(2.5, 0.65),
            new THREE.MeshBasicMaterial({ map: new THREE.CanvasTexture(lc), transparent: true, depthWrite: false, side: THREE.DoubleSide })
        );
        label.position.y = 2.35;
        group.add(label);
        group.userData.label = label;

        this.scene.add(group);
        this._playerMeshes.set(id, group);
        return group;
    }

    _removePlayerMesh(id) {
        const g = this._playerMeshes.get(id);
        if (g) { this.scene.remove(g); this._playerMeshes.delete(id); }
    }

    // ── Bullet pool ───────────────────────────────────────────────────────────

    _getPooledBullet() {
        if (this._bulletPool.length > 0) { const m = this._bulletPool.pop(); m.visible = true; return m; }
        const mat  = new THREE.MeshBasicMaterial({ color: 0xff9900 });
        const mesh = new THREE.Mesh(new THREE.SphereGeometry(0.18, 6, 6), mat);
        this.scene.add(mesh);
        return mesh;
    }
    _returnToPool(mesh) { mesh.visible = false; this._bulletPool.push(mesh); }

    // ── Main update ───────────────────────────────────────────────────────────

    updateFromState(gameState, localId, input) {
        if (!gameState) return;
        this.localId = localId;
        this._time += 0.016;

        // Animate water
        this._animateWater();

        // Sway palm trees
        this._palmTrees.forEach((palm, i) => {
            palm.rotation.z = Math.sin(this._time * 0.8 + i) * 0.04;
        });

        // Drift clouds
        this._clouds.forEach(cloud => {
            cloud.userData.angle += cloud.userData.speed * 0.003;
            cloud.position.x = Math.sin(cloud.userData.angle) * cloud.userData.dist;
            cloud.position.z = Math.cos(cloud.userData.angle) * cloud.userData.dist;
        });

        const playerSet = new Set();
        for (const pd of (gameState.players || [])) {
            playerSet.add(pd.id);
            if (pd.id === localId) {
                this._updateLocalCamera(pd, input);
            } else {
                this._updateRemotePlayer(pd);
            }
        }
        for (const [id] of this._playerMeshes) {
            if (!playerSet.has(id)) this._removePlayerMesh(id);
        }

        const bulletSet = new Set();
        for (const bd of (gameState.bullets || [])) {
            bulletSet.add(bd.id);
            let mesh = this._bulletMeshes.get(bd.id);
            if (!mesh) { mesh = this._getPooledBullet(); this._bulletMeshes.set(bd.id, mesh); }
            mesh.position.set(bd.x, bd.y, bd.z);
        }
        for (const [id, mesh] of this._bulletMeshes) {
            if (!bulletSet.has(id)) { this._returnToPool(mesh); this._bulletMeshes.delete(id); }
        }

        if (gameState.zone) {
            const r = gameState.zone.radius;
            this.zoneRing.scale.set(r, r, r);
            this.zoneRing.position.set(gameState.zone.x, 0.3, gameState.zone.z);
            this.zoneWall.scale.set(r, 1, r);
            this.zoneWall.position.x = gameState.zone.x;
            this.zoneWall.position.z = gameState.zone.z;
            this.zoneRing.material.color.set(r < 12 ? 0xff2244 : r < 22 ? 0xff8800 : 0x00e5ff);
        }
    }

    _animateWater() {
        if (!this._waterMesh) return;
        const pos  = this._waterMesh.geometry.attributes.position;
        const orig = this._waterOrigY;
        const t    = this._time;
        for (let i = 0; i < pos.count; i++) {
            const x = pos.getX(i), z = pos.getZ(i);
            const wave = Math.sin(x * 0.15 + t) * 0.22 + Math.sin(z * 0.12 + t * 1.3) * 0.18 + Math.sin((x + z) * 0.09 + t * 0.7) * 0.12;
            pos.setY(i, orig[i * 3 + 1] + wave);
        }
        pos.needsUpdate = true;
        this._waterMesh.geometry.computeVertexNormals();
    }

    _updateLocalCamera(pd, input) {
        this.camera.position.set(pd.x, pd.y + 1.6, pd.z);
        if (input) {
            const fwd = { x: Math.sin(input.yaw)*Math.cos(input.pitch), y: Math.sin(input.pitch), z: Math.cos(input.yaw)*Math.cos(input.pitch) };
            this.camera.lookAt(pd.x + fwd.x, pd.y + 1.6 + fwd.y, pd.z + fwd.z);
        }
    }

    _updateRemotePlayer(pd) {
        if (!pd.alive) { const g = this._playerMeshes.get(pd.id); if (g) g.visible = false; return; }
        const group = this._getOrCreatePlayerMesh(pd.id);
        group.visible = true;
        group.position.lerp(new THREE.Vector3(pd.x, pd.y, pd.z), 0.35);
        group.rotation.y = -pd.yaw;
        if (group.userData.label) group.userData.label.quaternion.copy(this.camera.quaternion);
    }

    // ── Resize ────────────────────────────────────────────────────────────────

    _onResize() {
        const w = window.innerWidth, h = window.innerHeight;
        this.camera.aspect = w / h;
        this.camera.updateProjectionMatrix();
        this.renderer.setSize(w, h);
    }

    render() { this.renderer.render(this.scene, this.camera); }
}
