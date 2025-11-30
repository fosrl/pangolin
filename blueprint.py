import requests
import yaml
import json
import base64

# The file path for the YAML file to be read
# You can change this to the path of your YAML file
YAML_FILE_PATH = 'blueprint.yaml'

# The API endpoint and headers from the curl request
API_URL = 'http://api.pangolin.net/v1/org/test/blueprint'
HEADERS = {
    'accept': '*/*',
    'Authorization': 'Bearer <your_token_here>',
    'Content-Type': 'application/json'
}

def convert_and_send(file_path, url, headers):
    """
    Reads a YAML file, converts its content to a JSON payload,
    and sends it via a PUT request to a specified URL.
    """
    try:
        # Read the YAML file content
        with open(file_path, 'r') as file:
            yaml_content = file.read()

        # Parse the YAML string to a Python dictionary
        # This will be used to ensure the YAML is valid before sending
        parsed_yaml = yaml.safe_load(yaml_content)

        # convert the parsed YAML to a JSON string
        json_payload = json.dumps(parsed_yaml)
        print("Converted JSON payload:")
        print(json_payload)

        # Encode the JSON string to Base64
        encoded_json = base64.b64encode(json_payload.encode('utf-8')).decode('utf-8')

        # Create the final payload with the base64 encoded data
        final_payload = {
            "blueprint": encoded_json
        }

        print("Sending the following Base64 encoded JSON payload:")
        print(final_payload)
        print("-" * 20)

        # Make the PUT request with the base64 encoded payload
        response = requests.put(url, headers=headers, json=final_payload)

        # Print the API response for debugging
        print(f"API Response Status Code: {response.status_code}")
        print("API Response Content:")
        print(response.text)

        # Raise an exception for bad status codes (4xx or 5xx)
        response.raise_for_status()

    except FileNotFoundError:
        print(f"Error: The file '{file_path}' was not found.")
    except yaml.YAMLError as e:
        print(f"Error parsing YAML file: {e}")
    except requests.exceptions.RequestException as e:
        print(f"An error occurred during the API request: {e}")
    except Exception as e:
        print(f"An unexpected error occurred: {e}")

# Run the function
if __name__ == "__main__":
    convert_and_send(YAML_FILE_PATH, API_URL, HEADERS)

