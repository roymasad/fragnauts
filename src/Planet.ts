import { Scene, Vector3, MeshBuilder, Color3, StandardMaterial, Mesh, Texture, Animation } from "@babylonjs/core";
import { PerlinNoiseProceduralTexture } from '@babylonjs/procedural-textures';

export class Planet {
    private noiseSeed: number;
    private baseRadius: number = 4; // Half of diameter (8)
    private mesh!: Mesh;
    private glowAnimation: Animation;
    private craterDepth: number = 1.6;// Controls how deep craters appear
    private craterFrequency: number = 2.0; // Controls how many craters appear

    constructor(private scene: Scene) {
        this.noiseSeed = Math.random() * 10000;
        
        // Create the glow animation
        this.glowAnimation = new Animation(
            "glowAnimation",
            "emissiveColor", // Remove 'material.' prefix from the property path
            30, // frames per second
            Animation.ANIMATIONTYPE_COLOR3,
            Animation.ANIMATIONLOOPMODE_CYCLE
        );
    }

    // Getter for the base radius
    getBaseRadius(): number {
        return this.baseRadius;
    }

    // Getter for the mesh
    getMesh(): Mesh {
        return this.mesh;
    }

    create(): Mesh {
        // Create a sphere as the base for our planet
        this.mesh = MeshBuilder.CreateSphere("planet", { 
            segments: 512,
            diameter: this.baseRadius * 2,
            updatable: true,
            sideOrientation: Mesh.FRONTSIDE 
            
        }, this.scene);

        // Generate random terrain by deforming the sphere
        const positions = this.mesh.getVerticesData("position");
        const normals = this.mesh.getVerticesData("normal");
        const uvs = this.mesh.getVerticesData("uv");
        
        if (positions && normals && uvs) {
            // First pass: Apply basic terrain noise
            for (let i = 0; i < positions.length; i += 3) {
                const x = positions[i];
                const y = positions[i + 1];
                const z = positions[i + 2];
                
                // Base noise for terrain variation
                const baseNoise = this.simplexNoise(x, y, z);
                const magnitude = 0.2;
                
                // Apply base terrain deformation
                positions[i] *= 1 + (baseNoise * magnitude);
                positions[i + 1] *= 1 + (baseNoise * magnitude);
                positions[i + 2] *= 1 + (baseNoise * magnitude);
            }
            
            // Second pass: Apply craters
            for (let i = 0; i < positions.length; i += 3) {
                const x = positions[i];
                const y = positions[i + 1];
                const z = positions[i + 2];
                
                // Calculate normalized direction vector from center to vertex
                const length = Math.sqrt(x*x + y*y + z*z);
                const nx = x / length;
                const ny = y / length;
                const nz = z / length;
                
                // Generate crater noise (negative values for depressions)
                const craterNoise = this.craterNoise(nx * this.craterFrequency, 
                                                    ny * this.craterFrequency, 
                                                    nz * this.craterFrequency);
                
                // Apply crater deformation (only sink inward, don't push outward)
                const craterEffect = Math.min(0, craterNoise) * this.craterDepth;
                
                // Apply the crater deformation in the direction of the normal
                positions[i] += nx * craterEffect;
                positions[i + 1] += ny * craterEffect;
                positions[i + 2] += nz * craterEffect;
            }
            
            // Update the mesh with new vertex positions
            this.mesh.updateVerticesData("position", positions);
            
            // Recalculate normals for proper lighting
            this.mesh.createNormals(true);
        }

        const material = new StandardMaterial("planetMaterial", this.scene);
        
        // Create base noise texture with higher resolution for better detail
        const randomTextureId = "perlinNoise_" + Math.floor(this.noiseSeed);
        // random nb from 128 to 2048
        const randomTextureSize = Math.floor(Math.random() * (2048 - 128 + 1)) + 128;
        const noiseTexture = new PerlinNoiseProceduralTexture(randomTextureId, randomTextureSize, this.scene);
        
        // Configure noise texture properties
        noiseTexture.setFloat("randomness", Math.random());
        noiseTexture.setFloat("persistence", 2.8);  // Higher persistence for more detailed noise
        noiseTexture.setFloat("amplitude", 0.5);    // Increased amplitude for stronger effect
        
        // Apply layered material properties for better terrain visualization
        //material.diffuseColor = this.getRandomColor();
        
        // Enhance bump mapping effect for more pronounced surface features
        material.bumpTexture = noiseTexture;
        material.bumpTexture.level = 0.4;  // Increased from 0.4 for more dramatic effect
        
        // Fine-tune material properties for better crater visibility
        material.specularColor = new Color3(0.05, 0.05, 0.05);
        material.roughness = 0.8;  // Increased roughness for more realistic terrain
        material.specularPower = 16;
        //material.ambientColor = new Color3(0.1, 0.1, 0.1);
        
        // Add slight displacement mapping to enhance craters
        material.useParallax = true;
        material.useParallaxOcclusion = true;
        material.parallaxScaleBias = 0.4;

        material.reflectionTexture = null;
        material.disableLighting = false;
        
        // Set up initial emissive color
        //material.emissiveColor = new Color3(0, 0, 0);
        
        // Create glow animation keyframes with stronger values
        const keys = [];
        keys.push({
            frame: 0,
            value: new Color3(0, 0, 0)
        });
        keys.push({
            frame: 30,
            value: new Color3(0.1, 0.1, 0.1) 
        });
        keys.push({
            frame: 60,
            value: new Color3(0, 0, 0)
        });
        
        this.glowAnimation.setKeys(keys);
        
        // Add animation to the mesh
        this.mesh.material = material;
        material.animations = material.animations || [];
        material.animations.push(this.glowAnimation);
        
        // Start the glow animation
        this.scene.beginAnimation(material, 0, 60, true);
        
        noiseTexture.wrapU = Texture.WRAP_ADDRESSMODE;
        noiseTexture.wrapV = Texture.WRAP_ADDRESSMODE;
        
        noiseTexture.uOffset = Math.random();
        noiseTexture.vOffset = Math.random();
        
        noiseTexture.refreshRate = 0;

        return this.mesh;
    }

    private simplexNoise(x: number, y: number, z: number): number {
        const scale = 0.8;
        const nx = Math.sin((x + this.noiseSeed) * scale);
        const ny = Math.cos((y + this.noiseSeed) * scale);
        const nz = Math.sin((z + this.noiseSeed) * scale);
        
        const f1 = this.noiseSeed * 0.01;
        const f2 = this.noiseSeed * 0.02;
        const f3 = this.noiseSeed * 0.03;
        
        return (
            Math.sin(nx * 1.0 + f1) * Math.cos(ny * 1.0 + f1) * Math.sin(nz * 1.0 + f1) * 0.5 +
            Math.sin(nx * 2.0 + f2) * Math.cos(ny * 2.0 + f2) * Math.sin(nz * 2.0 + f2) * 0.25 +
            Math.sin(nx * 4.0 + f3) * Math.cos(ny * 4.0 + f3) * Math.sin(nz * 4.0 + f3) * 0.125
        );
    }

    // Specialized noise function for crater generation
    private craterNoise(x: number, y: number, z: number): number {
        // Use a different seed offset for craters to get different patterns than the base terrain
        const craterSeed = this.noiseSeed * 1.5;
        
        // Scale parameters to control crater size distribution
        const scale = 1.2;
        
        // Generate normalized coordinates for noise calculation
        const nx = Math.sin((x + craterSeed) * scale);
        const ny = Math.cos((y + craterSeed) * scale);
        const nz = Math.sin((z + craterSeed) * scale);
        
        // Create frequency offsets for different noise octaves
        const f1 = craterSeed * 0.03;
        const f2 = craterSeed * 0.07;
        const f3 = craterSeed * 0.11;
        
        // Combine multiple noise octaves with different frequencies
        // Using sharp transitions to create crater-like features
        let noise = (
            Math.sin(nx * 3.0 + f1) * Math.cos(ny * 3.0 + f1) * Math.sin(nz * 3.0 + f1) * 0.4 +
            Math.sin(nx * 7.0 + f2) * Math.cos(ny * 7.0 + f2) * Math.sin(nz * 7.0 + f2) * 0.4 +
            Math.sin(nx * 13.0 + f3) * Math.cos(ny * 13.0 + f3) * Math.sin(nz * 13.0 + f3) * 0.2
        );
        
        // Apply transformation to make sharper, crater-like depressions
        // This will create more distinct crater edges
        noise = Math.pow(Math.abs(noise), 1.5) * Math.sign(noise);
        
        // Apply threshold to control which areas become craters
        // Only values below this threshold will form craters
        const threshold = -0.1;
        
        // If noise is above threshold, nullify it to keep original surface
        // If below, amplify the effect to create deeper craters
        return noise < threshold ? noise * 1.5 : 0;
    }

    private getRandomColor(): Color3 {
        const h = Math.random() * 0.3 + 0.5;
        const s = Math.random() * 0.3 + 0.4;
        const l = Math.random() * 0.3 + 0.2;

        const r = l + s * Math.cos(2 * Math.PI * h);
        const g = l + s * Math.cos(2 * Math.PI * (h + 1/3));
        const b = l + s * Math.cos(2 * Math.PI * (h + 2/3));

        return new Color3(r, g, b);
    }
}