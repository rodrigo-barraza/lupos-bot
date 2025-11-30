const token = '***REMOVED***'

const LightWrapper = {
    async validateColor(color) {
        const response = await fetch(`https://api.lifx.com/v1/color?string=${color}`, {
            method: 'GET',
            headers: {
                'Authorization': `Bearer ${token}`,
                'Content-Type': 'application/json'
            }
        })
        const data = await response.json()
        return data
    },
    async getLights(lightId = 'all') {
        const response = await fetch(`https://api.lifx.com/v1/lights/${lightId}`, {
            headers: {
                'Authorization': `Bearer ${token}`,
                'Content-Type': 'application/json'
            }
        })
        const data = await response.json()
        return data
    },
    async setState(state, lightId = 'all') {
        const body = {
            power: state?.power || 'on',
            color: state?.color || 'white',
            brightness: state?.brightness || 1,
            duration: state?.duration || 1,
            // infrared: state?.infrared || ,
            fast: state?.fast || true,
            // hue: attributes.hue,
            // saturation: attributes.saturation,
            // kelvin: attributes.kelvin,
        }
        const response = await fetch(`https://api.lifx.com/v1/lights/${lightId}/state`, {
            method: 'PUT',
            headers: {
                'Authorization': `Bearer ${token}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify(body)
        })

        if (response.status === 202) {
            return true;
        }

        const data = await response.json()
        return data
    },
    async setStateDelta(state, lightId = 'all') {
        const body = {
            power: state?.power || 'on',
            duration: state?.duration || 1,
            hue: state?.hue || 0,
            saturation: state?.saturation || 1,
            brightness: state?.brightness || 1,
            kelvin: state?.kelvin || 2500,
            fast: state?.fast || false
        }
        const response = await fetch(`https://api.lifx.com/v1/lights/${lightId}/state/delta`, {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${token}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify(body)
        })
        const data = await response.json()
        return data
    },
    async togglePower(lightId = 'all', duration = 1) {
        const body = {
            duration: duration
        }
        const response = await fetch(`https://api.lifx.com/v1/lights/${lightId}/toggle`, {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${token}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify(body)
        })
        const data = await response.json()
        return data
    },
    async randomizeColor(lightId = 'all', duration = 1) {
        // const colors = [
        //     'purple', 'red', 'orange', 'yellow', 'green', 'blue', 'indigo'
        // ];

        // colors as hex values
        const colors = [
            '#800080',
            '#FF0000',
            '#FFA500',
            '#FFFF00',
            '#008000',
            '#0000FF',
            '#4B0082',
            '#FF00FF',  // Magenta/Hot Pink - very vibrant
            '#00FFFF',  // Cyan - opposite of red/pink
            '#FF0000',  // Pure Red - strong primary
            '#00FF00',  // Lime/Neon Green - electric bright
            '#0000FF',  // Pure Blue - cool contrast
            '#FFFF00',  // Yellow - maximum brightness
            '#FF4500',  // Orange Red - intense warm
            '#9400D3',  // Violet - deep purple
            '#00CED1',  // Dark Turquoise - unique blue-green
            '#FF1493',  // Deep Pink - vibrant pink
            '#32CD32',  // Lime Green - different from neon
            '#FF8C00',  // Dark Orange - rich warm
        ];
        
        // Initialize the current color if it doesn't exist
        if (!this.currentColor) {
            this.currentColor = colors[Math.floor(Math.random() * colors.length)];
        }

        try {
            // Filter out the current color to avoid picking the same one
            const availableColors = colors.filter(color => color !== this.currentColor);
            
            // Pick a random color from the available colors
            const randomIndex = Math.floor(Math.random() * availableColors.length);
            const newColor = availableColors[randomIndex];
            
            // Set the new color
            await this.setState({ color: newColor, duration: duration }, lightId);
            
            // Update the current color
            this.currentColor = newColor;
        } catch (error) {
            console.error('Error randomizing color:', error);
        }
    },
    async cycleColor(lightId = 'all', style='rainbow', duration = 0.3) {
        // const rainbowColors = [
        //     '#800080',
        //     '#FF0000',
        //     '#FFA500',
        //     '#FFFF00',
        //     '#008000',
        //     '#0000FF',
        //     '#4B0082',
        //     '#FF00FF',  // Magenta/Hot Pink - very vibrant
        //     '#00FFFF',  // Cyan - opposite of red/pink
        //     '#FF0000',  // Pure Red - strong primary
        //     '#00FF00',  // Lime/Neon Green - electric bright
        //     '#0000FF',  // Pure Blue - cool contrast
        //     '#FFFF00',  // Yellow - maximum brightness
        //     '#FF4500',  // Orange Red - intense warm
        //     '#9400D3',  // Violet - deep purple
        //     '#00CED1',  // Dark Turquoise - unique blue-green
        //     '#FF1493',  // Deep Pink - vibrant pink
        //     '#32CD32',  // Lime Green - different from neon
        //     '#FF8C00',  // Dark Orange - rich warm
        // ];

        const rainbowColors = [
            // Deep Reds
            '#8B0000',  // Dark Red - deep burgundy
            '#A52A2A',  // Brown Red - rich terra cotta
            '#B22222',  // Firebrick - deep warm red
            '#CD5C5C',  // Indian Red - muted deep red
            '#DC143C',  // Crimson - deep pure red
            
            // Deep Red-Oranges
            '#CC4125',  // Burnt Sienna - deep rust
            '#D2691E',  // Chocolate - deep orange-brown
            '#CD853F',  // Peru - deep tan orange
            
            // Deep Oranges
            '#CC5500',  // Burnt Orange - deep pure orange
            '#D2691E',  // Deep Orange Brown
            '#FF8C00',  // Dark Orange - rich warm
            
            // Deep Yellows/Golds
            '#B8860B',  // Dark Goldenrod - deep golden
            '#DAA520',  // Goldenrod - rich gold
            '#D4AF37',  // Old Gold - antique gold
            '#C9B037',  // Vegas Gold - deep metallic
            
            // Deep Yellow-Greens
            '#9ACD32',  // Yellow Green - deep lime
            '#8B8C0A',  // Dark Yellow Green - olive tone
            '#6B8E23',  // Olive Drab - military green
            
            // Deep Greens
            '#228B22',  // Forest Green - deep forest
            '#2E7D32',  // Deep Green - rich pure
            '#006400',  // Dark Green - very deep
            '#355E3B',  // Hunter Green - deep classic
            '#2F4F2F',  // Dark Slate Green - deep muted
            
            // Deep Teals/Turquoises
            '#008B8B',  // Dark Cyan - deep teal
            '#2F4F4F',  // Dark Slate Gray - deep blue-green
            '#008080',  // Teal - deep blue-green
            '#20B2AA',  // Light Sea Green - deep aqua
            
            // Deep Blues
            '#4682B4',  // Steel Blue - muted deep
            '#4169E1',  // Royal Blue - rich pure
            '#0047AB',  // Cobalt Blue - deep vibrant
            '#002FA7',  // International Klein Blue
            '#191970',  // Midnight Blue - very deep
            '#000080',  // Navy Blue - classic deep
            
            // Deep Indigos/Blue-Violets
            '#4B0082',  // Indigo - deep blue-purple
            '#483D8B',  // Dark Slate Blue - muted deep
            '#6A0DAD',  // Deep Purple - rich violet
            
            // Deep Purples/Violets
            '#663399',  // Rebecca Purple - medium deep
            '#8B008B',  // Dark Magenta - deep pink-purple
            '#800080',  // Purple - classic deep
            '#702963',  // Byzantium - deep royal purple
            
            // Deep Magentas/Red-Violets
            '#8B008B',  // Dark Magenta - deep magenta
            '#C71585',  // Medium Violet Red - deep pink
            '#B03060',  // Maroon - deep red-purple
        ];

        const newRainbowColors = [
            '#ff1200',
            '#ff3200',
            '#ff4800',
            '#ff6300',
            '#ff7f00',
            '#ff9500',
            '#ffa600',
            '#ffa900',
            '#ffbd00',
            '#ffe200',
            '#fff000',
            '#fffa00',
            '#f7fd09',
            '#e8ff00',
            '#d4ff00',
            '#b7ff00',
            '#9aff00',
            '#7dff00',
            '#60ff00',
            '#43ff00',
            '#26ff00',
            '#00ff00',
            '#00ff26',
            '#00ff4d',
            '#00ff73',
            '#00ff99',
            '#00ffbf',
            '#00ffe6',
            '#00f4ff',
            '#00d4ff',
            '#00b4ff',
            '#0094ff',
            '#0074ff',
            '#0054ff',
            '#0033ff',
            '#1a00ff',
            '#3300ff',
            '#4d00ff',
            '#6600ff',
            '#8000ff',
            '#9900ff',
            '#b300ff',
            '#cc00ff',
            '#e600ff',
            '#ff00ff',
            '#ff00e6',
            '#ff00cc',
            '#ff00c7',
            '#ff0022',
            '#ff0019',
        ];


        const purpleColors = [
            // Deep Indigos/Blue-Violets
            '#191970',  // Midnight Blue - deepest blue-purple
            '#2E0854',  // Deep Indigo - very dark purple
            '#4B0082',  // Indigo - classic deep
            '#483D8B',  // Dark Slate Blue - muted deep
            '#4C2882',  // Spanish Violet - deep royal
            
            // Deep Purples
            '#5B2C6F',  // Deep Purple - rich dark
            '#663399',  // Rebecca Purple - medium deep
            '#6A0DAD',  // True Purple - deep vibrant
            '#702963',  // Byzantium - deep royal purple
            '#800080',  // Purple - classic deep
            '#8B008B',  // Dark Magenta - deep magenta
            
            // Deep Violet-Reds
            '#892B64',  // Deep Plum - dark plum
            '#8E4585',  // Plum - rich medium
            '#9932CC',  // Dark Orchid - deep orchid
            '#9B30FF',  // Purple1 - deep electric
            '#BA55D3',  // Medium Orchid - rich orchid
            
            // Deep Magentas/Pinks
            '#B03060',  // Maroon - deep red-purple
            '#C71585',  // Medium Violet Red - deep pink
            '#CD2990',  // Deep Magenta Pink
            '#D02090',  // Violet Red - deep fuchsia
            '#DB7093',  // Pale Violet Red - muted deep
        ];

        const greenColors = [
            // Deep Forest Greens
            '#0B3D0B',  // Deep Forest - darkest green
            '#013220',  // Dark Green - very deep
            '#006400',  // Dark Green - classic deep
            '#0F4C0F',  // Forest Night - deep shadow
            '#1B4D1B',  // Hunter Green Deep
            
            // Deep Pure Greens
            '#228B22',  // Forest Green - rich forest
            '#2E7D32',  // Deep Green - pure deep
            '#355E3B',  // Hunter Green - classic deep
            '#3D8B37',  // Deep Grass Green
            '#4B7C4B',  // Deep Sage Green
            
            // Deep Blue-Greens
            '#2F4F2F',  // Dark Slate Green - muted deep
            '#2E8B57',  // Sea Green - deep ocean
            '#3B7F5F',  // Deep Jade Green
            '#008080',  // Teal - deep cyan-green
            '#008B8B',  // Dark Cyan - deep teal
            
            // Deep Yellow-Greens
            '#4A5D23',  // Dark Olive - deep olive
            '#556B2F',  // Dark Olive Green - rich olive
            '#6B8E23',  // Olive Drab - military green
            '#708238',  // Deep Moss Green
            '#7C9051',  // Deep Sage - muted yellow-green
        ];

        const redColors = [
            // Deep Burgundies/Wines
            '#4B0013',  // Deep Burgundy - darkest red
            '#5C0120',  // Bordeaux - deep wine
            '#722F37',  // Wine - deep merlot
            '#800020',  // Burgundy - classic deep
            '#8B0000',  // Dark Red - pure deep
            
            // Deep Pure Reds
            '#A52A2A',  // Brown Red - deep terra
            '#B22222',  // Firebrick - deep warm
            '#C21E56',  // Rose Red - deep rose
            '#CD212A',  // Fire Engine Red - deep vibrant
            '#DC143C',  // Crimson - rich deep red
            
            // Deep Red-Oranges
            '#A0522D',  // Sienna - deep brown-red
            '#B22222',  // Deep Scarlet
            '#C65D00',  // Deep Amber - rich orange
            '#CC4125',  // Burnt Sienna - deep rust
            '#CD5C5C',  // Indian Red - muted deep
            
            // Deep Oranges
            '#CC5500',  // Burnt Orange - deep orange
            '#D2691E',  // Chocolate - deep orange-brown
            '#D97700',  // Deep Orange - rich pure
            '#E25822',  // Flame - deep fire orange
            '#FF8C00',  // Dark Orange - rich warm
        ];

        let colors;
        if (style === 'rainbow') {
            colors = newRainbowColors;
        } else if (style === 'purples') {
            colors = purpleColors;
        } else if (style === 'greens') {
            colors = greenColors;
        } else if (style === 'reds') {
            colors = redColors;
        } else {
            console.error('Invalid style. Use "rainbow", "purples", "greens", or "reds".');
            return;
        }

        // Initialize or check if style has changed
        if (!this.currentStyle || this.currentStyle !== style) {
            // New style or first run - reset index
            this.colorIndex = 0;
            this.currentStyle = style;
        }

        try {
            const color = colors[this.colorIndex];
            await this.setState({ color: color, duration: duration }, lightId);

            // Move to next color, cycling back to 0 after last color
            this.colorIndex = (this.colorIndex + 1) % colors.length;
        } catch (error) {
            console.error('Error cycling color:', error);
        }
    }
};

module.exports = LightWrapper;
