// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {Script} from "forge-std/Script.sol";
import {console2} from "forge-std/console2.sol";

import {AckLinkVault} from "../src/acklink/AckLinkVault.sol";

contract DeployAckLinkVault is Script {
    function run() external {
        uint256 pk = vm.envUint("PRIVATE_KEY_DEPLOYER");
        address usdc = vm.envAddress("USDC");

        vm.startBroadcast(pk);
        AckLinkVault vault = new AckLinkVault(usdc);
        vm.stopBroadcast();

        console2.log("ACKLINK_VAULT:", address(vault));
    }
}
