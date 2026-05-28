/**
 * renderer.js  ─  Three.js rendering engine
 *
 * Manages the 3D scene:
 *  ─ Arena geometry (floor, boundary wall, cover boxes, centre tower)
 *  ─ Dynamic player meshes (FPS: local player hidden; remote players shown)
 *  ─ Bullet meshes (pooled spheres)
 *  ─ Zone ring (scales with zone radius)
 *  ─ FPS camera (eye position + yaw/pitch look)
 *  ─ Lighting and sky colour
 */
class Renderer {
    constructor(canvas) {
        this.canvas      = canvas;
        this.localId     = null;

        // Mesh maps
        this._playerMeshes = new Map();   // playerId → THREE.Group
        this._bulletMeshes = new Map();   // bulletId → THREE.Mesh
        this._bulletPool   = [];          // reusable inactive meshes

        this._initThree();
        this._buildArena();
        this._buildZoneRing();
        this._buildLights();
        this._onResize();

        window.addEventListener('resize', () => this._onResize());
    }

    // ── Three.js bootstrap ────────────────────────────────────────────────────

    _initThree() {
        this.scene = new THREE.Scene();
        this.scene.background = new THREE.Color(0x0d1117);
        this.scene.fog = new THREE.FogExp2(0x0d1117, 0.008);

        this.camera = new THREE.PerspectiveCamera(
            75,
            this.canvas.clientWidth / this.canvas.clientHeight,
            0.05, 250
        );

        this.renderer = new THREE.WebGLRenderer({
            canvas: this.canvas,
            antialias: true,
            powerPreference: 'high-performance'
        });
        this.renderer.shadowMap.enabled = true;
        this.renderer.shadowMap.type    = THREE.PCFSoftShadowMap;
        this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    }

    // ── Arena geometry ────────────────────────────────────────────────────────

    _buildArena() {
        // ── Floor ─────────────────────────────────────────────────────────────
        const floorGeo = new THREE.CircleGeometry(52, 64);
        floorGeo.rotateX(-Math.PI / 2);
        const floorMat = new THREE.MeshLambertMaterial({ color: 0x1a1a2e });
        const floor    = new THREE.Mesh(floorGeo, floorMat);
        floor.receiveShadow = true;
        this.scene.add(floor);

        // Grid lines on floor for depth perception
        const gridHelper = new THREE.GridHelper(100, 20, 0x2a2a4a, 0x1e1e3a);
        gridHelper.position.y = 0.01;
        this.scene.add(gridHelper);

        // ── Arena boundary wall (inner face visible) ──────────────────────────
        const wallGeo = new THREE.CylinderGeometry(51, 51, 6, 64, 1, true);
        const wallMat = new THREE.MeshLambertMaterial({
            color: 0x1e3a5f, side: THREE.BackSide, transparent: true, opacity: 0.7
        });
        const wall = new THREE.Mesh(wallGeo, wallMat);
        wall.position.y = 3;
        this.scene.add(wall);

        // Outer wall (looks like a barrier)
        const outerWallGeo = new THREE.CylinderGeometry(52, 52, 8, 64, 1, true);
        const outerWallMat = new THREE.MeshLambertMaterial({
            color: 0x0a1628, side: THREE.FrontSide
        });
        const outerWall = new THREE.Mesh(outerWallGeo, outerWallMat);
        outerWall.position.y = 4;
        this.scene.add(outerWall);

        // ── Cover boxes ───────────────────────────────────────────────────────
        const coverMat  = new THREE.MeshLambertMaterial({ color: 0x2d4a6b });
        const coverMat2 = new THREE.MeshLambertMaterial({ color: 0x3d2b1f });

        const coverData = [
            // [x, z, width, height, depth]
            [ 14,  8,  4, 2.5, 4],
            [-14,  8,  4, 2.5, 4],
            [  8,-14,  4, 2.5, 4],
            [ -8,-14,  4, 2.5, 4],
            [ 28,  2,  5, 3.0, 3],
            [-28,  2,  5, 3.0, 3],
            [  2, 28,  3, 3.0, 5],
            [  2,-28,  3, 3.0, 5],
        ];

        coverData.forEach(([x, z, w, h, d], i) => {
            const geo  = new THREE.BoxGeometry(w, h, d);
            const mat  = (i % 2 === 0) ? coverMat : coverMat2;
            const mesh = new THREE.Mesh(geo, mat);
            mesh.position.set(x, h / 2, z);
            mesh.castShadow    = true;
            mesh.receiveShadow = true;
            this.scene.add(mesh);
        });

        // ── Central tower ─────────────────────────────────────────────────────
        const towerBase = this._makeTowerPart(7, 10, 7, 5, 0x1a2d45);
        towerBase.position.set(0, 5, 0);
        this.scene.add(towerBase);

        const towerTop = this._makeTowerPart(5, 3, 5, 8.5, 0x243750);
        towerTop.position.set(0, 8.5, 0);
        this.scene.add(towerTop);

        // Ramp to tower (a long flat box)
        const rampGeo = new THREE.BoxGeometry(2, 0.3, 14);
        const ramp    = new THREE.Mesh(rampGeo, new THREE.MeshLambertMaterial({ color: 0x1e3050 }));
        ramp.position.set(0, 0.15, -10);
        ramp.rotation.x = -0.15;
        this.scene.add(ramp);

        // ── Accent pillars ────────────────────────────────────────────────────
        const pillarAngles = [0, Math.PI / 2, Math.PI, Math.PI * 1.5];
        const pillarMat    = new THREE.MeshLambertMaterial({ color: 0x152238 });
        pillarAngles.forEach(angle => {
            const geo = new THREE.CylinderGeometry(1, 1.3, 6, 8);
            const m   = new THREE.Mesh(geo, pillarMat);
            m.position.set(Math.sin(angle) * 42, 3, Math.cos(angle) * 42);
            m.castShadow = true;
            this.scene.add(m);
        });
    }

    _makeTowerPart(w, h, d, y, color) {
        const geo  = new THREE.BoxGeometry(w, h, d);
        const mat  = new THREE.MeshLambertMaterial({ color });
        const mesh = new THREE.Mesh(geo, mat);
        mesh.castShadow    = true;
        mesh.receiveShadow = true;
        return mesh;
    }

    // ── Zone ring ─────────────────────────────────────────────────────────────

    _buildZoneRing() {
        // A torus at y = 0.1 that we scale to match the zone radius.
        // Initial radius = 1 unit; we'll scale it to zone.radius each frame.
        const geo = new THREE.TorusGeometry(1, 0.25, 8, 80);
        const mat = new THREE.MeshBasicMaterial({
            color: 0x00e5ff, transparent: true, opacity: 0.85
        });
        this.zoneRing = new THREE.Mesh(geo, mat);
        this.zoneRing.rotation.x = -Math.PI / 2;
        this.zoneRing.position.y = 0.2;
        this.scene.add(this.zoneRing);

        // Vertical zone wall (thin cylinder shell)
        const wallGeo = new THREE.CylinderGeometry(1, 1, 60, 64, 1, true);
        const wallMat = new THREE.MeshBasicMaterial({
            color: 0x003c8f, transparent: true, opacity: 0.12, side: THREE.DoubleSide
        });
        this.zoneWall = new THREE.Mesh(wallGeo, wallMat);
        this.zoneWall.position.y = 15;
        this.scene.add(this.zoneWall);
    }

    // ── Lights ────────────────────────────────────────────────────────────────

    _buildLights() {
        const ambient = new THREE.AmbientLight(0x334466, 0.8);
        this.scene.add(ambient);

        const sun = new THREE.DirectionalLight(0xffd6a5, 1.0);
        sun.position.set(30, 60, 40);
        sun.castShadow = true;
        sun.shadow.mapSize.width  = 2048;
        sun.shadow.mapSize.height = 2048;
        sun.shadow.camera.near   = 0.5;
        sun.shadow.camera.far    = 200;
        sun.shadow.camera.left   = -60;
        sun.shadow.camera.right  =  60;
        sun.shadow.camera.top    =  60;
        sun.shadow.camera.bottom = -60;
        this.scene.add(sun);

        // Cool fill light from opposite side
        const fill = new THREE.DirectionalLight(0x4488ff, 0.35);
        fill.position.set(-20, 10, -30);
        this.scene.add(fill);
    }

    // ── Player meshes ─────────────────────────────────────────────────────────

    _playerColor(id) {
        // Deterministic colour from player ID
        let h = 0;
        for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) & 0xffffff;
        const hue = (h % 360) / 360;
        return new THREE.Color().setHSL(hue, 0.85, 0.55);
    }

    _getOrCreatePlayerMesh(id) {
        if (this._playerMeshes.has(id)) return this._playerMeshes.get(id);

        const group = new THREE.Group();
        const color = this._playerColor(id);
        const mat   = new THREE.MeshLambertMaterial({ color });

        // Body (cylinder)
        const bodyGeo  = new THREE.CylinderGeometry(0.45, 0.45, 1.4, 10);
        const body     = new THREE.Mesh(bodyGeo, mat);
        body.position.y = 0.7;
        body.castShadow = true;
        group.add(body);

        // Head (sphere)
        const headGeo = new THREE.SphereGeometry(0.38, 10, 8);
        const headMat = new THREE.MeshLambertMaterial({ color: color.clone().multiplyScalar(1.3) });
        const head    = new THREE.Mesh(headGeo, headMat);
        head.position.y = 1.65;
        head.castShadow = true;
        group.add(head);

        // Gun stub
        const gunGeo = new THREE.BoxGeometry(0.12, 0.12, 0.6);
        const gunMat = new THREE.MeshLambertMaterial({ color: 0x888888 });
        const gun    = new THREE.Mesh(gunGeo, gunMat);
        gun.position.set(0.35, 1.3, 0.5);
        group.add(gun);

        // Name label (simple sprite-like plane)
        const labelCanvas  = document.createElement('canvas');
        labelCanvas.width  = 256;
        labelCanvas.height = 64;
        const ctx = labelCanvas.getContext('2d');
        ctx.fillStyle    = 'rgba(0,0,0,0)';
        ctx.fillRect(0, 0, 256, 64);
        ctx.font         = 'bold 28px monospace';
        ctx.textAlign    = 'center';
        ctx.fillStyle    = '#ffffff';
        ctx.fillText(id.slice(0, 12), 128, 44);

        const tex     = new THREE.CanvasTexture(labelCanvas);
        const labelGeo = new THREE.PlaneGeometry(2.5, 0.65);
        const labelMat = new THREE.MeshBasicMaterial({
            map: tex, transparent: true, depthWrite: false, side: THREE.DoubleSide
        });
        const label = new THREE.Mesh(labelGeo, labelMat);
        label.position.y = 2.35;
        group.add(label);
        group.userData.label = label;

        this.scene.add(group);
        this._playerMeshes.set(id, group);
        return group;
    }

    _removePlayerMesh(id) {
        const group = this._playerMeshes.get(id);
        if (group) {
            this.scene.remove(group);
            this._playerMeshes.delete(id);
        }
    }

    // ── Bullet mesh pool ──────────────────────────────────────────────────────

    _getPooledBullet() {
        if (this._bulletPool.length > 0) {
            const m = this._bulletPool.pop();
            m.visible = true;
            return m;
        }
        const geo  = new THREE.SphereGeometry(0.18, 6, 6);
        const mat  = new THREE.MeshBasicMaterial({ color: 0xff9900 });
        const mesh = new THREE.Mesh(geo, mat);
        this.scene.add(mesh);

        // Glow (point light on bullet — expensive but looks great)
        // Disabled by default; enable for fewer players
        // const light = new THREE.PointLight(0xff6600, 1.5, 4);
        // mesh.add(light);

        return mesh;
    }

    _returnToPool(mesh) {
        mesh.visible = false;
        this._bulletPool.push(mesh);
    }

    // ── Main update (called every frame) ─────────────────────────────────────

    /**
     * @param {Object} gameState  Latest server state
     * @param {string} localId    Local player's ID
     * @param {PlayerInput} input Current input handler (for camera)
     */
    updateFromState(gameState, localId, input) {
        if (!gameState) return;
        this.localId = localId;

        const playerSet = new Set();

        for (const pd of (gameState.players || [])) {
            playerSet.add(pd.id);
            if (pd.id === localId) {
                // FPS: update camera position based on server position
                this._updateLocalCamera(pd, input);
            } else {
                this._updateRemotePlayer(pd);
            }
        }

        // Remove meshes for disconnected players
        for (const [id] of this._playerMeshes) {
            if (!playerSet.has(id)) this._removePlayerMesh(id);
        }

        // Update bullets
        const bulletSet = new Set();
        for (const bd of (gameState.bullets || [])) {
            bulletSet.add(bd.id);
            let mesh = this._bulletMeshes.get(bd.id);
            if (!mesh) {
                mesh = this._getPooledBullet();
                this._bulletMeshes.set(bd.id, mesh);
            }
            mesh.position.set(bd.x, bd.y, bd.z);
        }
        for (const [id, mesh] of this._bulletMeshes) {
            if (!bulletSet.has(id)) {
                this._returnToPool(mesh);
                this._bulletMeshes.delete(id);
            }
        }

        // Update zone ring and wall
        if (gameState.zone) {
            const r = gameState.zone.radius;
            this.zoneRing.scale.set(r, r, r);
            this.zoneRing.position.set(gameState.zone.x, 0.2, gameState.zone.z);
            this.zoneWall.scale.set(r, 1, r);
            this.zoneWall.position.x = gameState.zone.x;
            this.zoneWall.position.z = gameState.zone.z;

            // Flash ring red when nearly closed
            const ringMat = this.zoneRing.material;
            ringMat.color.set(r < 12 ? 0xff2244 : r < 22 ? 0xff8800 : 0x00e5ff);
        }
    }

    _updateLocalCamera(pd, input) {
        // Eye height: player.y + 1.6
        this.camera.position.set(pd.x, pd.y + 1.6, pd.z);

        if (input) {
            // Look direction from input yaw / pitch
            const fwd = {
                x: Math.sin(input.yaw)  * Math.cos(input.pitch),
                y: Math.sin(input.pitch),
                z: Math.cos(input.yaw)  * Math.cos(input.pitch)
            };
            this.camera.lookAt(
                pd.x + fwd.x,
                pd.y + 1.6 + fwd.y,
                pd.z + fwd.z
            );
        }
    }

    _updateRemotePlayer(pd) {
        if (!pd.alive) {
            // Hide mesh when dead
            const g = this._playerMeshes.get(pd.id);
            if (g) g.visible = false;
            return;
        }

        const group = this._getOrCreatePlayerMesh(pd.id);
        group.visible = true;

        // Smooth lerp toward server position (interpolation)
        group.position.lerp(new THREE.Vector3(pd.x, pd.y, pd.z), 0.35);
        group.rotation.y = -pd.yaw;

        // Name label always faces camera
        if (group.userData.label) {
            group.userData.label.quaternion.copy(this.camera.quaternion);
        }
    }

    // ── Resize ────────────────────────────────────────────────────────────────

    _onResize() {
        const w = window.innerWidth;
        const h = window.innerHeight;
        this.camera.aspect = w / h;
        this.camera.updateProjectionMatrix();
        this.renderer.setSize(w, h);
    }

    // ── Render ────────────────────────────────────────────────────────────────

    render() {
        this.renderer.render(this.scene, this.camera);
    }
}
