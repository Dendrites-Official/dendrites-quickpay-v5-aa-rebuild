// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {Script} from "forge-std/Script.sol";
import {console2} from "forge-std/console2.sol";

import {MockERC20Permit} from "../src/MockERC20Permit.sol";

contract DeployMockERC20Permit is Script {
    function run() external {
        uint256 pk = vm.envUint("PRIVATE_KEY_DEPLOYER");

        vm.startBroadcast(pk);

        MockERC20Permit token = new MockERC20Permit();

        vm.stopBroadcast();

        console2.log("MOCK_ERC20_PERMIT:", address(token));
    }
}
