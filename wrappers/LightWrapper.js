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
            fast: state?.fast || false,
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
};

module.exports = LightWrapper;
